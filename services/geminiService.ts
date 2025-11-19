
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

export const analyzeBOM = async (
  rawRows: RawBOMRow[],
  apiKey: string,
  model: string
): Promise<PowerAnalysisResult[]> => {
  const openai = getAiClient(apiKey);
  const rowsToProcess = rawRows.slice(0, 50); 

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
       - If a datasheet is found, YOU MUST provide the URL in 'sourceUrl'.
       - **CITATION**: If you find a datasheet, you MUST extract the exact text snippet that indicates the power value. Put this in 'typicalPowerCitation' and 'maxPowerCitation'.
         - Example: "Max Power Consumption: 480W" or "Typical 350W @ 100% Load".
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
      "confidence": "string (High, Medium, Low)",
      "notes": "string"
    }
  `;

  const completion = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Input Data: ${JSON.stringify(rowsToProcess)}` }
    ],
    response_format: { type: "json_object" }
  });

  const content = completion.choices[0].message.content;
  if (!content) throw new Error("No response from AI");

  try {
    const parsed = JSON.parse(content);
    return parsed.items || [];
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("Failed to parse AI response");
  }
};

export const reEstimateItems = async (
  items: PowerAnalysisResult[],
  apiKey: string,
  model: string
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
    - If you find a specific datasheet/product page, provide the URL in 'sourceUrl'.
    - **EXTRACT TEXT**: If you found the value in a document, copy the specific text snippet into 'typicalPowerCitation' and 'maxPowerCitation'.
    - **STRICT URL RULE**: The URL must be a DIRECT link to a manufacturer page (e.g., cisco.com, dell.com) or a PDF. 
    - **FORBIDDEN**: Do NOT provide 'google.com/search' or 'google.com/url' links. Leave null if no direct link found.
    
    Strictly classify the SOURCE of your data:
    - 'Datasheet': You are certain of the spec (Provide URL and Citation).
    - 'Estimation': You are inferring based on component class.
    - 'Formula': You calculated it (e.g. Watts to BTU).

    Provide a 'methodology' string explaining your logic.
    Return a JSON object with a key "items" containing the updated array.
  `;

  const completion = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Items to re-estimate: ${JSON.stringify(items)}` }
    ],
    response_format: { type: "json_object" }
  });

  const content = completion.choices[0].message.content;
  if (!content) throw new Error("No response from AI");

  try {
    const parsed = JSON.parse(content);
    return parsed.items || [];
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("Failed to parse AI response");
  }
};
