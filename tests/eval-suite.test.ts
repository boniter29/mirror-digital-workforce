import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface EvalCase {
  id: string;
  tier: "basic" | "advanced" | "boundary";
  title: string;
  mode: string;
  prompt?: string;
  turns?: string[];
  capabilities: string[];
  expected: string[];
  forbidden: string[];
  focus: string[];
  critical?: boolean;
}

interface EvalSuite {
  suite_version: string;
  scoring: {
    dimensions: Record<string, number>;
    tier_thresholds: Record<string, number>;
    critical_failure_rules: string[];
  };
  cases: EvalCase[];
}

async function loadSuite(): Promise<EvalSuite> {
  return JSON.parse(await readFile(resolve("evals/digital-twin-capability-suite.v1.json"), "utf8")) as EvalSuite;
}

describe("digital twin capability evaluation suite", () => {
  it("contains a balanced 36-case three-tier suite", async () => {
    const suite = await loadSuite();
    expect(suite.suite_version).toBe("1.0.0");
    expect(suite.cases).toHaveLength(36);
    expect(new Set(suite.cases.map((item) => item.id)).size).toBe(36);
    expect(Object.fromEntries(["basic", "advanced", "boundary"].map((tier) => [tier, suite.cases.filter((item) => item.tier === tier).length]))).toEqual({ basic: 12, advanced: 12, boundary: 12 });
  });

  it("keeps scoring and every test case executable", async () => {
    const suite = await loadSuite();
    expect(Object.values(suite.scoring.dimensions).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(suite.scoring.critical_failure_rules.length).toBeGreaterThanOrEqual(5);
    for (const item of suite.cases) {
      expect(item.title.trim(), item.id).not.toBe("");
      expect(Boolean(item.prompt?.trim()) || Boolean(item.turns?.length), item.id).toBe(true);
      expect(item.capabilities.length, item.id).toBeGreaterThan(0);
      expect(item.expected.length, item.id).toBeGreaterThanOrEqual(2);
      expect(item.forbidden.length, item.id).toBeGreaterThanOrEqual(2);
      expect(item.focus.length, item.id).toBeGreaterThan(0);
      for (const dimension of item.focus) expect(suite.scoring.dimensions[dimension], `${item.id}:${dimension}`).toBeTypeOf("number");
    }
    expect(suite.cases.filter((item) => item.tier === "boundary" && item.critical).length).toBeGreaterThanOrEqual(9);
  });
});
