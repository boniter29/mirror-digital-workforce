import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

describe("Electron overlay and composer floating layers", () => {
  it("reserves the Windows caption-button area in the draggable top bar", () => {
    expect(styles).toMatch(/\.topbar\s*\{[^}]*padding:\s*0 154px 0 20px/);
  });

  it("allows the composer permission menu to escape the rounded composer", () => {
    expect(styles).toMatch(/\.studio-composer\s*\{[^}]*overflow:\s*visible/);
    expect(styles).toMatch(/\.composer-permission-menu\s*\{[^}]*z-index:\s*40/);
  });
});
