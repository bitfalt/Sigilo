// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @dev The subset of ERC-20 the vault uses. AUSD (6 decimals) on Monad testnet.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @dev The one IncomePassportVerifier function the vault needs. `verify` is a view that never
///      reverts on bad input and also checks that the registry root is a recent, known one.
interface IPassportVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @title AdvanceVault
/// @notice Salary advances repaid from payroll (SPEC.md F7, §9). A lender funds the vault with
///         AUSD. A worker proves, with the `income_passport` circuit and this vault's own scope,
///         that one verified employer paid her at least `threshold` USD cents in each of three
///         consecutive recent months, and receives up to `maxRatioBps` of that monthly amount in
///         a fresh account she controls. Her employer's payroll repays the advance plus a fee.
///
/// @dev Public input layout (IncomePassportVerifier's): [0] registryRoot, [1..3] periods (month
///      indexes), [4] threshold (USD cents, u64), [5] scope, [6] nonce, [7] pseudonym.
///
///      Binding: the proof does not commit to the recipient, so the request does it through the
///      nonce: nonce == keccak256(abi.encode(recipient, amount, deadline, salt)) mod r. Anyone
///      (e.g. Sigilo's relayer) can submit the request, but nobody can change where the money
///      goes, how much, or until when. Each nonce works once, even after the advance is closed.
///
///      Must match packages/core/src/advance.ts (advanceNonce, vaultScope, maxAdvance,
///      advanceOwed). No upgrade path. The lender can only withdraw the vault's balance; she
///      cannot touch issued advances, repayments in flight, or anyone's allowance.
contract AdvanceVault {
    /// @notice BN254 scalar field modulus.
    uint256 internal constant BN254_R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant BPS = 10_000;
    /// @notice USD cents (2 decimals) to AUSD base units (6 decimals).
    uint256 public constant CENTS_TO_AUSD = 1e4;
    uint256 public constant PUBLIC_INPUT_COUNT = 8;
    /// @notice The newest proven month may be at most this many months before the current one
    ///         (UTC), so the passport shows current employment. Matches core's
    ///         PASSPORT_MAX_AGE_MONTHS.
    uint256 public constant MAX_PASSPORT_AGE_MONTHS = 2;

    /// @dev Transient slot of the reentrancy lock: uint256(keccak256("sigilo.advancevault.lock")).
    uint256 private constant LOCK_SLOT =
        0x3cf92edd4cba9302a06c97ab7833a1141f1b45858ba966cad04536b031e4a198;

    /// @dev Amounts fit in 96 bits: amount <= 2^64 cents * 1e4 * 100% < 2^78, owed < 2^79.
    struct Advance {
        /// @notice The worker's pseudonym for this vault's scope.
        uint256 pseudonym;
        /// @notice The account that received the money.
        address recipient;
        /// @notice AUSD base units sent to `recipient`.
        uint96 principal;
        /// @notice principal + fee, in AUSD base units.
        uint96 owed;
        /// @notice AUSD base units repaid so far.
        uint96 repaid;
        uint40 issuedAt;
        bool active;
    }

    IERC20 public immutable ausd;
    IPassportVerifier public immutable verifier;
    /// @notice Owner of the liquidity. Deposits are plain AUSD transfers to this contract.
    address public immutable lender;
    /// @notice Max advance as a share of the proven monthly threshold, in basis points.
    uint16 public immutable maxRatioBps;
    /// @notice Flat fee on the principal, in basis points (rounded up).
    uint16 public immutable feeBps;
    /// @notice uint256(keccak256(abi.encode(address(this), block.chainid))) mod r. Proofs must
    ///         carry it; the worker's pseudonym is H(secret, scope), unique to this vault.
    uint256 public immutable scope;

    /// @notice Number of advances ever issued. Ids start at 1.
    uint256 public advanceCount;
    /// @notice The open advance of a pseudonym, or 0.
    mapping(uint256 pseudonym => uint256 advanceId) public activeAdvanceOf;
    /// @notice Consumed request nonces.
    mapping(uint256 nonce => bool used) public nonceUsed;
    mapping(uint256 advanceId => Advance) internal _advances;

    event AdvanceIssued(
        uint256 indexed advanceId,
        uint256 indexed pseudonym,
        address indexed recipient,
        uint256 amount,
        uint256 owed
    );
    event AdvanceRepaid(
        uint256 indexed advanceId, address indexed payer, uint256 paid, uint256 remaining
    );
    event AdvanceClosed(uint256 indexed advanceId);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error InvalidTerms();
    error NotLender();
    error ZeroAmount();
    error Expired();
    error WrongPublicInputCount();
    error WrongScope();
    error NonceMismatch();
    error NonceAlreadyUsed();
    error PassportTooOld();
    error AmountAboveLimit(uint256 max);
    error AdvanceAlreadyActive(uint256 advanceId);
    error InsufficientLiquidity();
    error InvalidProof();
    error AdvanceNotActive();
    error TokenCallFailed();
    error Reentrancy();

    /// @dev Transient-storage lock (EIP-1153; Monad supports it): a few hundred gas instead of
    ///      the ~10k a cold storage lock costs on Monad.
    modifier nonReentrant() {
        _lock();
        _;
        _unlock();
    }

    /// @param maxRatioBps_ In (0, 10000]: an advance is at most one proven month of pay.
    /// @param feeBps_ In [0, 10000].
    constructor(
        IERC20 ausd_,
        IPassportVerifier verifier_,
        address lender_,
        uint16 maxRatioBps_,
        uint16 feeBps_
    ) {
        if (
            address(ausd_) == address(0) || address(verifier_) == address(0)
                || lender_ == address(0)
        ) revert ZeroAddress();
        if (maxRatioBps_ == 0 || maxRatioBps_ > BPS || feeBps_ > BPS) revert InvalidTerms();
        ausd = ausd_;
        verifier = verifier_;
        lender = lender_;
        maxRatioBps = maxRatioBps_;
        feeBps = feeBps_;
        scope = uint256(keccak256(abi.encode(address(this), block.chainid))) % BN254_R;
    }

    // ---------------------------------------------------------------- advances

    /// @notice Issue an advance of `amount` AUSD to `recipient` against an income passport.
    ///         Callable by anyone; the proof's nonce must commit to (recipient, amount, deadline,
    ///         salt), see `nonceFor`.
    /// @dev Cheap checks run before the proof verification (millions of gas).
    /// @return advanceId The new advance's id.
    function requestAdvance(
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        uint256 amount,
        address recipient,
        uint256 deadline,
        bytes32 salt
    ) external nonReentrant returns (uint256 advanceId) {
        (uint256 nonce, uint256 pseudonym) =
            _checkRequest(publicInputs, amount, recipient, deadline, salt);
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        // Effects.
        uint256 owed = advanceOwed(amount);
        nonceUsed[nonce] = true;
        advanceId = ++advanceCount;
        activeAdvanceOf[pseudonym] = advanceId;
        // Casts are safe: amount <= maxAdvance(u64) < 2^78 and owed <= 2 * amount (see Advance);
        // uint40 seconds last until the year 36812.
        _advances[advanceId] = Advance({
            pseudonym: pseudonym,
            recipient: recipient,
            // forge-lint: disable-next-line(unsafe-typecast)
            principal: uint96(amount),
            // forge-lint: disable-next-line(unsafe-typecast)
            owed: uint96(owed),
            repaid: 0,
            // forge-lint: disable-next-line(unsafe-typecast)
            issuedAt: uint40(block.timestamp),
            active: true
        });
        // The only earlier external call is the view `verifier.verify` (a staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit AdvanceIssued(advanceId, pseudonym, recipient, amount, owed);

        // Interaction.
        _call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
    }

    /// @notice Repay up to `amount` of an open advance from the caller (needs an AUSD allowance).
    ///         Anyone can repay; in practice the employer's treasury does it during payroll.
    ///         Pulls at most what is still owed. Closes the advance when nothing is left.
    /// @return paid AUSD base units actually pulled.
    function repay(uint256 advanceId, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        Advance storage a = _advances[advanceId];
        if (!a.active) revert AdvanceNotActive();

        uint256 remaining = a.owed - a.repaid;
        paid = amount < remaining ? amount : remaining;
        remaining -= paid;
        // Safe cast: paid <= owed < 2^96.
        // forge-lint: disable-next-line(unsafe-typecast)
        a.repaid += uint96(paid);
        // Events and state changes all happen before the token call below.
        // forge-lint: disable-next-line(reentrancy-events)
        emit AdvanceRepaid(advanceId, msg.sender, paid, remaining);
        if (remaining == 0) {
            a.active = false;
            delete activeAdvanceOf[a.pseudonym];
            // forge-lint: disable-next-line(reentrancy-events)
            emit AdvanceClosed(advanceId);
        }

        _call(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), paid)));
    }

    // ---------------------------------------------------------------- lender

    /// @notice Withdraw liquidity (including repayments) to `to`. Lender only.
    function withdraw(address to, uint256 amount) external nonReentrant {
        if (msg.sender != lender) revert NotLender();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // forge-lint: disable-next-line(reentrancy-events)
        emit Withdrawn(to, amount);
        _call(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    // ---------------------------------------------------------------- views

    function advances(uint256 advanceId) external view returns (Advance memory) {
        return _advances[advanceId];
    }

    /// @notice What is still owed on an advance (0 once closed or if unknown).
    function remainingOf(uint256 advanceId) external view returns (uint256) {
        Advance storage a = _advances[advanceId];
        return a.owed - a.repaid;
    }

    /// @notice Largest advance, in AUSD base units, for a proven monthly threshold in USD cents.
    function maxAdvance(uint64 thresholdCents) public view returns (uint256) {
        return uint256(thresholdCents) * CENTS_TO_AUSD * maxRatioBps / BPS;
    }

    /// @notice principal + fee, with the fee rounded up.
    function advanceOwed(uint256 amount) public view returns (uint256) {
        return amount + (amount * feeBps + BPS - 1) / BPS;
    }

    /// @notice The nonce a request for (recipient, amount, deadline, salt) must prove with.
    function nonceFor(address recipient, uint256 amount, uint256 deadline, bytes32 salt)
        public
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(recipient, amount, deadline, salt))) % BN254_R;
    }

    /// @notice Month index (year * 12 + month - 1, UTC) of a unix timestamp, as in
    ///         packages/core/src/period.ts.
    /// @dev Howard Hinnant's civil_from_days (days since 1970-01-01 to a proleptic Gregorian
    ///      date); exact for every uint timestamp.
    function periodOf(uint256 timestamp) public pure returns (uint256) {
        // Integer calendar math: the truncating divisions are the algorithm.
        // forge-lint: disable-start(divide-before-multiply)
        uint256 z = timestamp / 86_400 + 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097; // [0, 146096]
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365], from March 1
        uint256 mp = (5 * doy + 2) / 153; // [0, 11], March = 0
        uint256 month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
        uint256 year = era * 400 + yoe + (month <= 2 ? 1 : 0);
        // forge-lint: disable-end(divide-before-multiply)
        return year * 12 + month - 1;
    }

    // ---------------------------------------------------------------- internals

    /// @dev Everything about a request except the proof itself. Returns its nonce and pseudonym.
    function _checkRequest(
        bytes32[] calldata publicInputs,
        uint256 amount,
        address recipient,
        uint256 deadline,
        bytes32 salt
    ) internal view returns (uint256 nonce, uint256 pseudonym) {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert WrongPublicInputCount();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert Expired();
        if (uint256(publicInputs[5]) != scope) revert WrongScope();

        nonce = uint256(publicInputs[6]);
        if (nonce == 0 || nonce != nonceFor(recipient, amount, deadline, salt)) {
            revert NonceMismatch();
        }
        if (nonceUsed[nonce]) revert NonceAlreadyUsed();

        // The circuit range-checks the threshold as a u64; anything larger can't be a valid proof.
        uint256 threshold = uint256(publicInputs[4]);
        if (threshold > type(uint64).max) revert InvalidProof();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 max = maxAdvance(uint64(threshold));
        if (amount > max) revert AmountAboveLimit(max);

        // periods[2] is the newest month (the circuit enforces consecutive periods).
        if (uint256(publicInputs[3]) + MAX_PASSPORT_AGE_MONTHS < periodOf(block.timestamp)) {
            revert PassportTooOld();
        }

        pseudonym = uint256(publicInputs[7]);
        uint256 open = activeAdvanceOf[pseudonym];
        if (open != 0) revert AdvanceAlreadyActive(open);
        if (ausd.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
    }

    function _lock() private {
        bool locked;
        assembly ("memory-safe") {
            locked := tload(LOCK_SLOT)
        }
        if (locked) revert Reentrancy();
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 1)
        }
    }

    function _unlock() private {
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 0)
        }
    }

    /// @dev AUSD call that accepts both bool-returning and non-returning ERC-20s (as SigiloPay).
    function _call(bytes memory data) internal {
        address token = address(ausd);
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) {
            revert TokenCallFailed();
        }
    }
}
