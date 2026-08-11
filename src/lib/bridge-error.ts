/** Thrown for any refusal condition the bridge must surface with a clear reason. */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}
