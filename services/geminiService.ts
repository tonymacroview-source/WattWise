
import OpenAI from "openai";
import { PowerAnalysisResult, RawBOMRow } from "../types";

// Initialize OpenAI Client for OpenRouter
const getAiClient = (apiKey: string) => {
  if (!apiKey) {
    throw new Error("API Key is required");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey,
    dangerouslyAllowBrowser: true
  });
};

/**
 * Helper to clean AI response that might contain Markdown or DeepSeek <think> tags
 * Includes logic to repair truncated JSON arrays
 */
const cleanAndParseJSON = (rawContent: string): any => {
  let content = rawContent;

  // 1. Remove DeepSeek R1 <think>...</think> blocks
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // 2. Remove Markdown code blocks (```json ... ```)
  content = content.replace(/```json/g, "").replace(/```/g, "");

  // 3. Trim whitespace
  content = content.trim();

  // Attempt 1: Standard Parse
  try {
    return JSON.parse(content);
  } catch (e) {
    // If standard parse fails, try to repair truncated JSON
    // This often happens when max_tokens is reached inside the "items" array
    
    const firstBrace = content.indexOf('{');
    if (firstBrace === -1) throw e; // Not even an object

    const itemsStart = content.indexOf('"items"');
    const arrayStart = content.indexOf('[', itemsStart);

    if (itemsStart !== -1 && arrayStart !== -1) {
       // We have an items array structure.
       // Try to find the last valid object closure "},"
       const lastCommaBrace = content.lastIndexOf('},');
       
       // Case A: Truncated after a comma (e.g., ..., { ... }, )
       if (lastCommaBrace > arrayStart) {
           const candidate = content.substring(firstBrace, lastCommaBrace + 1) + ']}';
           try {
               const parsed = JSON.parse(candidate);
               console.warn("Repaired truncated JSON response (Type A)");
               return parsed;
           } catch (e2) { /* continue */ }
       }

       // Case B: Truncated inside an object or after a closing brace without comma
       // Find the last "}" that isn't the one we just checked (if any)
       // We basically want to close the array after the last "}" found.
       const lastBrace = content.lastIndexOf('}');
       if (lastBrace > arrayStart) {
           // Try to close it there
           const candidate = content.substring(firstBrace, lastBrace + 1) + ']}';
           try {
               const parsed = JSON.parse(candidate);
               console.warn("Repaired truncated JSON response (Type B)");
               return parsed;
           } catch (e3) { /* continue */ }
       }
    }

    console.error("JSON Parse Failed. Raw Content:", rawContent);
    console.error("Cleaned Content:", content);
    throw e;
  }
};

/**
 * Retry helper with exponential backoff
 */
const withRetry = async <T>(
  fn: () => Promise<T>, 
  retriesLeft: number, 
  delay: number,
  onRetry?: (message: string | null) => void,
  attempt: number = 1
): Promise<T> => {
  try {
    // Clear warning message when starting a new attempt (if it's a retry)
    // This allows the UI to revert to the normal "Processing" animation
    if (attempt > 1 && onRetry) {
        onRetry(null);
    }
    return await fn();
  } catch (error: any) {
    if (retriesLeft <= 0) throw error;
    
    const isRateLimit = error?.status === 429 || error?.message?.includes('rate limit') || error?.code === 'rate_limit_exceeded';
    const isParseError = error instanceof SyntaxError || error?.message?.includes('JSON');
    const isNetworkError = error?.message?.includes('fetch'); // Connection errors

    // Retry on rate limits, parse errors (often due to bad LLM output), or network blips
    if (isRateLimit || isParseError || isNetworkError) {
      const errorType = isRateLimit ? 'Rate Limit' : isParseError ? 'Parse Error' : 'Network Error';
      const msg = `Attempt ${attempt} failed (${errorType}). Retrying in ${delay/1000}s...`;
      
      console.warn(msg);
      if (onRetry) onRetry(msg);

      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retriesLeft - 1, delay * 2, onRetry, attempt + 1);
    }

    throw error;
  }
};

export const analyzeBOM = async (
  rawRows: RawBOMRow[],
  apiKey: string,
  model: string,
  maxRetries: number = 3,
  onRetry?: (msg: string | null) => void
): Promise<PowerAnalysisResult[]> => {
  const openai = getAiClient(apiKey);
  // Reduce batch size to 20 to prevent token truncation with verbose responses
  const rowsToProcess = rawRows.slice(0, 20); 

  const systemPrompt = `
    You are a Senior Data Center Infrastructure Engineer. 
    I will provide a list of BOM (Bill of Materials) items.
    
    Your task is to identify components and provide professional-grade power and thermal estimation.
    
    REQUIREMENTS:
    1. **Identification**: Identify the Part Number/Model. Normalize names into a "modelFamily" (e.g., group "C9300-48P" and "C9300-NM" under "Cisco Catalyst 9300").
    2. **Power Analysis**: 
       - **Typical Power**: Estimate the average operational power draw (Wall Draw).
       - **Max Power**: Estimate the maximum power draw (Wall Draw).
       
       **CRITICAL RULE FOR POWER SUPPLY UNITS (PSU)**:
       Do NOT assign power values to Power Supply Units (PSUs) listed as separate line items.
       - In IT BOMs, PSUs are often redundant spares or internal components whose load is already accounted for in the main chassis/server power spec.
       - **Set 'typicalPowerWatts' to 0.**
       - **Set 'maxPowerWatts' to 0.**
       - **Set 'heatDissipationBTU' to 0.**
       - Set 'methodology' to "Ignored: Power accounted for in Chassis".
       
    3. **Data Provenance & Citations**:
       - For EACH value, determine if it comes from a **Datasheet** (exact match found) or **Estimation**.
       - If a datasheet is found, YOU MUST provide the URL in 'sourceUrl' and the Title in 'sourceTitle'.
       - **CITATION**: If you find a datasheet, you MUST extract the exact text snippet that indicates the power value. Put this in 'typicalPowerCitation' and 'maxPowerCitation'.
       - **PROOF**: Extract the text snippet that proves this datasheet matches the requested model. Put this in 'matchedModelSnippet'. (e.g. "Table 5. Power specifications for C9300-48P").
       - **STRICT URL RULE**: The URL must be a DIRECT link to a manufacturer page (e.g., cisco.com, dell.com) or a PDF. 
       - **FORBIDDEN**: Do NOT provide 'google.com/search', 'google.com/url', or 'bing.com' URLs. These cause "Rate Limited" errors for the user. If no direct link is found, leave 'sourceUrl' empty.
       - For Heat, if calculated via formula, mark as **Formula**.
    4. **Passive Components**: Cables, racks, and patch panels have 0 Watts and 0 BTU.
    
    Return a JSON object with a single key "items".

    JSON Schema:
    {
      "partNumber": "string",
      "description": "string",
      "modelFamily": "string",
      "quantity": number,
      "category": "string (Compute, Network, Storage, Infrastructure, Peripheral)",
      
      "typicalPowerWatts": number,
      "typicalSource": "string (Datasheet, Estimation)",
      "typicalPowerCitation": "string (Exact text snippet from datasheet, or null)",
      
      "maxPowerWatts": number,
      "maxSource": "string (Datasheet, Estimation)",
      "maxPowerCitation": "string (Exact text snippet from datasheet, or null)",
      
      "heatDissipationBTU": number,
      "heatSource": "string (Datasheet, Formula)",
      
      "methodology": "string (Short explanation: e.g., 'Datasheet Spec', 'Est. 60% of Max', 'Ignored: PSU')",
      "sourceUrl": "string (Direct URL to datasheet or null. NO GOOGLE SEARCH LINKS.)",
      "sourceTitle": "string (Title of the webpage or document found, or null)",
      "matchedModelSnippet": "string (Text snippet confirming the model match, e.g. 'Specifications for Model XYZ', or null)",
      "confidence": "string (High, Medium, Low)",
      "notes": "string"
    }
  `;

  return withRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Input Data: ${JSON.stringify(rowsToProcess)}` }
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const parsed = cleanAndParseJSON(content);
    return parsed.items || [];
  }, maxRetries, 2000, onRetry);
};

export const reEstimateItems = async (
  items: PowerAnalysisResult[],
  apiKey: string,
  model: string,
  maxRetries: number = 3,
  onRetry?: (msg: string | null) => void
): Promise<PowerAnalysisResult[]> => {
  const openai = getAiClient(apiKey);

  const systemPrompt = `
    You are a Senior Data Center Power Engineer.
    RE-EVALUATE the power and thermal metrics for the provided items.
    Consult specific datasheets. 
    
    CRITICAL RULES:
    1. **PSU IGNORE**: 
       - If the item is a Power Supply Unit (PSU), set Watts and BTU to 0.
       - We assume the power load is calculated on the main device (Server/Switch).
       - Mark methodology as "Ignored: Power accounted for in Chassis".
       
    2. **URL & CITATION**: 
    - If you find a specific datasheet/product page, provide the URL in 'sourceUrl' and Title in 'sourceTitle'.
    - **EXTRACT TEXT**: If you found the value in a document, copy the specific text snippet into 'typicalPowerCitation' and 'maxPowerCitation'.
    - **PROOF**: Extract text snippet proving the model match into 'matchedModelSnippet'.
    - **STRICT URL RULE**: The URL must be a DIRECT link to a manufacturer page (e.g., cisco.com, dell.com) or a PDF. 
    - **FORBIDDEN**: Do NOT provide 'google.com/search' or 'google.com/url' links. Leave null if no direct link found.
    
    Strictly classify the SOURCE of your data:
    - 'Datasheet': You are certain of the spec (Provide URL, Title, Proof, and Citation).
    - 'Estimation': You are inferring based on component class.
    - 'Formula': You calculated it (e.g. Watts to BTU).

    Provide a 'methodology' string explaining your logic.
    Return a JSON object with a key "items" containing the updated list.
    Follow the same JSON schema as the analysis step.
  `;

  return withRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Items to Re-Estimate: ${JSON.stringify(items)}` }
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const parsed = cleanAndParseJSON(content);
    return parsed.items || [];
  }, maxRetries, 2000, onRetry);
};
