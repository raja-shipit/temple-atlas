import Anthropic from "@anthropic-ai/sdk";
import type { Category, ExtractionResult, VideoForExtraction } from "@/lib/types";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  EXTRACTION_TOOL,
} from "@/lib/extraction-prompt";

// Server-side only — called from /api/cron/sync (spec Section 3: "Anthropic
// API, called server-side only... API key never exposed to the browser").
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY env var.");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function extractTemplesFromVideo(
  video: VideoForExtraction,
  existingCategories: Category[]
): Promise<ExtractionResult> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: buildExtractionSystemPrompt(existingCategories),
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
    messages: [
      {
        role: "user",
        content: buildExtractionUserPrompt(video),
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error(
      `Extraction for video ${video.videoId} returned no tool_use block — forced tool_choice should make this impossible. Raw response: ${JSON.stringify(message.content)}`
    );
  }

  const parsed = toolUse.input as { temples: ExtractionResult["temples"] };

  return {
    videoId: video.videoId,
    temples: parsed.temples,
  };
}
