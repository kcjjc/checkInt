export type CollectCode = "NOT_FOUND" | "ACCESS_DENIED" | "FAILED";

export class CollectError extends Error {
  readonly code: CollectCode;

  constructor(message: string, code: CollectCode) {
    super(message);
    this.name = "CollectError";
    this.code = code;
  }
}

export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}
