import { describe, expect, it } from "vitest";
import { parseYouTubeId, scoreToString } from "./youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["not-a-video-id", null],
  ])("parses %s", (input, expected) => {
    expect(parseYouTubeId(input)).toBe(expected);
  });
});

describe("scoreToString", () => {
  it("formats scores without inventing a value for unrated clips", () => {
    expect(scoreToString(null)).toBe("—");
    expect(scoreToString(4.24)).toBe("4.2");
  });
});
