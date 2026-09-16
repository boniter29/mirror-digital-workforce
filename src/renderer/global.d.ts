import type { TwinBridge } from "../shared/types";

declare global {
  interface Window {
    twin?: TwinBridge;
  }
}

export {};
