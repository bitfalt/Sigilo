// One mark per payroll piece, as a stranger sees it. Three states, told apart by fill as well as
// color (validated for color-blind readers): hidden (solid ultramarine), spent on its own
// (hollow: visible, but tied to nothing), spent together with other pieces (solid red: tied to
// one owner).

import { cn } from "cn";

export type PieceState = "linked" | "spent" | "hidden";

const MARK: Record<PieceState, string> = {
  hidden: "bg-[#3a52c9]",
  spent: "border-[1.5px] border-[#4f6359]",
  linked: "bg-[#b23a48]",
};

export const PIECE_STATE_COPY: Record<PieceState, string> = {
  hidden: "Never spent: can't be tied to anyone",
  spent: "Spent on its own: tied to nothing else",
  linked: "Spent together with others: tied to one owner",
};

export function PieceMark({ state, className }: { state: PieceState; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-4 w-2.5 shrink-0 rounded-[2px]", MARK[state], className)}
    />
  );
}

/** A payout's pieces: the linked ones first, then the ones spent alone, then the hidden ones. */
export function PieceStrip({
  linked,
  spent,
  hidden,
  label,
  className,
}: {
  linked: number;
  spent: number;
  hidden: number;
  label: string;
  className?: string;
}) {
  const states: PieceState[] = [
    ...Array<PieceState>(linked).fill("linked"),
    ...Array<PieceState>(spent).fill("spent"),
    ...Array<PieceState>(hidden).fill("hidden"),
  ];
  return (
    <span role="img" aria-label={label} className={cn("flex flex-wrap gap-[3px]", className)}>
      {states.map((s, i) => (
        <PieceMark key={i} state={s} />
      ))}
    </span>
  );
}

export function PieceLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2 text-sm", className)}>
      {(["hidden", "spent", "linked"] as const).map((s) => (
        <li key={s} className="flex items-center gap-2.5">
          <PieceMark state={s} />
          <span>{PIECE_STATE_COPY[s]}</span>
        </li>
      ))}
    </ul>
  );
}
