// People this device has sent money to: their account id (public) and the name on their link.
// A convenience only; losing it just means opening their link again.

export interface Contact {
  account: string;
  name: string;
}

const KEY = "sigilo.contacts";

export function loadContacts(): Contact[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Contact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveContact(contact: Contact): Contact[] {
  const next = [contact, ...loadContacts().filter((c) => c.account !== contact.account)].slice(
    0,
    12,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: fine, the link still works.
  }
  return next;
}

/** Changes a saved person's name, keeping their place in the list. */
export function renameContact(account: string, name: string): Contact[] {
  const next = loadContacts().map((c) => (c.account === account ? { ...c, name } : c));
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: the new name lasts for this visit only.
  }
  return next;
}

/** The `to` and `name` of a Sigilo "send to" link, if `text` is one. */
export function parseSendLink(text: string): Contact | null {
  try {
    const url = new URL(text.trim());
    const account = url.searchParams.get("to");
    if (!account || !/^[a-z0-9]{20,40}$/.test(account)) return null;
    return { account, name: url.searchParams.get("name")?.slice(0, 40) ?? "" };
  } catch {
    return null;
  }
}
