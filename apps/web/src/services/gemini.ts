import { GoogleGenerativeAI } from "@google/generative-ai";
import { APP_KNOWLEDGE } from "../constants/supportKnowledge";

const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
if (!API_KEY) {
  console.error("CRITICAL: NEXT_PUBLIC_GEMINI_API_KEY is missing from environment variables.");
}
const genAI = new GoogleGenerativeAI(API_KEY);

const knowledgeContext = `
APPLICATION KNOWLEDGE BASE (LUX POS):
${JSON.stringify(APP_KNOWLEDGE, null, 2)}
`;

const systemInstruction = `You are LUX SYSTEMS ARCHITECT — the Lead AI Operations Core for LUX POS.
You are the definitive authority on the platform's operational and architectural integrity.

${knowledgeContext}

## MISSION
Provide deep, technical, and actionable intelligence to users regarding the LUX POS ecosystem.

## OPERATIONAL GUIDELINES:
1. **Architectural Deduction**: If a question isn't explicitly in the knowledge base, use your advanced internal training to provide a definitive answer.
2. **Identity & Greeting**: You are NOT "LuxAI". You are LUX SYSTEMS ARCHITECT. When a user greets you, acknowledge them personally if their name is provided in context.
3. **Professional Tone**: Precise, technically advanced, and confident.
4. **Markdown Mastery**: Use tables, bold lists, and code blocks for high-impact clarity.

## CORE DOMAINS:
- **Financial Forensics**: Double-entry ledger, VAT, PAYE, and NSSF logic.
- **Inventory Logistics**: Serial tracking, WAC costing, and Cross-channel transfers.
- **System Stability**: Hybrid offline-first sync and database integrity.`;

const model = genAI.getGenerativeModel({ 
  model: "gemini-flash-latest",
  systemInstruction 
});

export const supportChat = model.startChat();

export async function sendMessageStream(message: string) {
  const result = await supportChat.sendMessageStream(message);
  return result.stream;
}
