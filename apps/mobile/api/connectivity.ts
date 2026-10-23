// What the app knows of its connection, gathered from the parts of the `api`
// module that talk to the network. There is no probe: a link is down when its
// last call failed, and up again when one succeeds.
export interface Connectivity {
  // Some link's last call failed.
  offline: boolean;
  // Uploads the device still owes the server.
  queued: number;
}

const downLinks = new Set<string>();
const listeners = new Set<(connectivity: Connectivity) => void>();
let queued = 0;

function current(): Connectivity {
  return { offline: downLinks.size > 0, queued };
}

function emit() {
  const connectivity = current();
  for (const listener of listeners) listener(connectivity);
}

// A link (the upload queue, the previews channel) reports how its last call went.
export function reportLink(link: string, up: boolean) {
  const changed = up ? downLinks.delete(link) : !downLinks.has(link);
  if (!up) downLinks.add(link);
  if (changed) emit();
}

export function reportQueued(count: number) {
  if (count === queued) return;
  queued = count;
  emit();
}

// Calls `onChange` with the connectivity now and each time it changes.
export function subscribeToConnectivity(onChange: (connectivity: Connectivity) => void): () => void {
  listeners.add(onChange);
  onChange(current());
  return () => {
    listeners.delete(onChange);
  };
}
