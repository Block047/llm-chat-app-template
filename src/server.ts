/**
 * LLM Chat Application - Platform-Agnostic Express Server
 *
 * Replaces Cloudflare Workers index.ts with a standard Node.js/Express server.
 * Uses OpenRouter API (OpenAI-compatible) for LLM access.
 * Supports streaming via Server-Sent Events (SSE).
 *
 * @license MIT
 */

import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ─── Config ────────────────────────────────────────────────────────────────────

// Swap this env var to change models without touching code.
// Other solid Groq free options:
//   llama-3.1-8b-instant  (faster, lighter)
//   gemma2-9b-it
//   mixtral-8x7b-32768
const MODEL_ID = process.env.MODEL_ID ?? "llama-3.3-70b-versatile";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const PORT = process.env.PORT ?? 3000;

// Your original system prompt — unchanged
const SYSTEM_PROMPT = `You are a helpful, friendly assistant for students. Provide concise and accurate responses.
When writing math, ALWAYS use LaTeX notation with double backslashes:
- Inline math: \\\\(x^2\\\\) 
- Display math: \\\\[x^2 = y^2\\\\]
Never drop or simplify backslashes in math expressions. Always preserve \\\\( and \\\\) and \\\\[ and \\\\] exactly as written.`;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Static Assets ─────────────────────────────────────────────────────────────

// __dirname = dist/ at runtime, so go up one level to reach public/
app.use(express.static(path.join(__dirname, "../public")));

// ─── Chat API Route ────────────────────────────────────────────────────────────

app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    if (!GROQ_API_KEY) {
      res.status(500).json({ error: "GROQ_API_KEY is not set" });
      return;
    }

    const { messages = [] } = req.body as { messages: ChatMessage[] };

    // Inject system prompt if missing (same logic as original)
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Call Groq — fully OpenAI-compatible
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      console.error("Groq error:", errorText);
      res.status(upstream.status).json({ error: "Upstream API error", detail: errorText });
      return;
    }

    // Stream the SSE response straight through to the client
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (error) {
    console.error("Error processing chat request:", error);
    // Only send headers if they haven't been sent yet (i.e. error before streaming started)
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process request" });
    }
  }
});

// ─── Catch-all: Serve index.html for SPA routing ───────────────────────────────

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

// ─── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using model: ${MODEL_ID}`);
});
