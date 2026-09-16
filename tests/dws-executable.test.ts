import { afterEach, describe, expect, it } from "vitest";
import { resolveDwsExecutable, withDwsOnPath } from "../src/main/dws-executable.js";

describe("resolveDwsExecutable", () => {
  const original = process.env.MIRROR_DWS_BIN;

  afterEach(() => {
    if (original === undefined) delete process.env.MIRROR_DWS_BIN;
    else process.env.MIRROR_DWS_BIN = original;
  });

  it("uses an explicit enterprise deployment override", () => {
    expect(resolveDwsExecutable({ ...process.env, MIRROR_DWS_BIN: "D:\\managed-tools\\dws.exe" })).toBe("D:\\managed-tools\\dws.exe");
  });

  it("falls back to PATH outside the packaged Electron runtime", () => {
    const previous = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    try {
      Reflect.deleteProperty(process, "resourcesPath");
      expect(resolveDwsExecutable({})).toBe("dws");
    } finally {
      if (previous !== undefined) Reflect.set(process, "resourcesPath", previous);
    }
  });

  it("exposes an installed DWS binary to Agent SDK Bash without changing the machine PATH", () => {
    const environment = withDwsOnPath({ Path: "C:\\Windows\\System32", MIRROR_DWS_BIN: "D:\\Mirror\\tools\\dws.exe" });
    expect(environment.Path?.split(";")[0]).toBe("D:\\Mirror\\tools");
    expect(process.env.Path).not.toBe(environment.Path);
  });
});
