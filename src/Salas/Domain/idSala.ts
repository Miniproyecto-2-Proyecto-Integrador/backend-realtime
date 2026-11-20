export function esIdSalaValido(id: unknown): id is string {
  return typeof id === "string" && /^(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9]{20})$/.test(id);
}
