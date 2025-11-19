
export interface RawBOMRow {
  [key: string]: string | number | undefined;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  ANALYZING = 'ANALYZING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export type MetricSource = 'Datasheet' | 'Estimation' | 'Formula';

export interface PowerAnalysisResult {
  partNumber: string;
  description: string;
  modelFamily: string; // Grouping key (e.g., "Dell R740", "Cisco C9300")
  quantity: number;
  category: string; // e.g., Server, Switch, Storage, Cabling
  
  // Power Metrics
  typicalPowerWatts: number; // Expected operational load (e.g., 50-70% load)
  typicalSource: MetricSource;
  typicalPowerCitation?: string; // Text snippet from datasheet justifying the value
  
  maxPowerWatts: number;     // Nameplate rating or Peak load (for provisioning)
  maxSource: MetricSource;
  maxPowerCitation?: string; // Text snippet from datasheet justifying the value
  
  // Thermal Metrics
  heatDissipationBTU: number; // BTU/hr
  heatSource: MetricSource;

  methodology: string; // Explanation of how values were derived
  sourceUrl?: string; // URL to the datasheet or product page
  confidence: 'High' | 'Medium' | 'Low';
  notes: string; 
}

export interface ProjectSummary {
  totalTypicalKW: number;
  totalMaxKW: number;
  totalBTU: number;
  totalComponents: number;
  highestConsumer: PowerAnalysisResult | null;
  breakdownByCategory: { name: string; value: number }[];
}
