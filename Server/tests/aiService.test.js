import { describe, it, expect, vi } from "vitest";
import { buildPrompt, buildExplainPrompt } from "../services/aiService.js";

describe("aiService", () => {
  it("buildPrompt includes the language in output", () => {
    const prompt = buildPrompt("console.log('hi');", "javascript", "");
    expect(prompt).toContain("Language: javascript");
  });

  it("buildPrompt includes the code in output", () => {
    const code = "console.log('hello');";
    const prompt = buildPrompt(code, "javascript", "");
    expect(prompt).toContain(code);
  });

  it("buildPrompt uses default message when no userPrompt given", () => {
    const prompt = buildPrompt("console.log('hi');", "javascript", "");
    expect(prompt).toContain("Suggest improvements or complete this code.");
  });

  it("buildPrompt uses userPrompt when provided", () => {
    const prompt = buildPrompt("console.log('hi');", "javascript", "Make this shorter");
    expect(prompt).toContain("Make this shorter");
  });

  it("buildExplainPrompt includes the language in output", () => {
    const prompt = buildExplainPrompt("console.log('hi');", "javascript");
    expect(prompt).toContain("javascript");
  });

  it("buildExplainPrompt includes the code in output", () => {
    const code = "console.log('hello');";
    const prompt = buildExplainPrompt(code, "javascript");
    expect(prompt).toContain(code);
  });
});
