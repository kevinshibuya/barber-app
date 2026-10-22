export function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented`);
}
