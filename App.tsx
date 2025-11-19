
import React, { useState, useCallback } from 'react';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import Dashboard from './components/Dashboard';
import { AnalysisStatus, PowerAnalysisResult, RawBOMRow } from './types';
import { parseExcelFile } from './services/excelService';
import { analyzeBOM } from './services/geminiService';
import { Key, Cpu, RefreshCw } from 'lucide-react';

const App: React.FC = () => {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [results, setResults] = useState<PowerAnalysisResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('tngtech/deepseek-r1t2-chimera:free');
  const [maxRetries, setMaxRetries] = useState(3);
  const [processingItems, setProcessingItems] = useState<string[]>([]);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!apiKey) {
        setErrorMsg("Please enter your OpenRouter API Key.");
        return;
    }

    setStatus(AnalysisStatus.PARSING);
    setErrorMsg(null);
    setProcessingItems([]);
    setRetryMessage(null);

    try {
      // 1. Parse File
      const rawRows = await parseExcelFile(file);
      
      if (rawRows.length === 0) {
        throw new Error("No data found in the file.");
      }

      // Extract items for the status animation
      // Look for columns like Description, Product, Model, or just use the longest string
      const sampleItems = rawRows.slice(0, 50).map((row: RawBOMRow) => {
         const keys = Object.keys(row);
         // Try to find Description
         const descKey = keys.find(k => k.toLowerCase().includes('desc'));
         if (descKey && row[descKey]) {
            const val = String(row[descKey]);
            return val.length > 40 ? val.substring(0, 40) + '...' : val;
         }
         
         // Try to find Part Number
         const partKey = keys.find(k => k.toLowerCase().includes('part') || k.toLowerCase().includes('model'));
         if (partKey && row[partKey]) return String(row[partKey]);

         // Fallback to first reasonably long string
         const values = Object.values(row);
         const fallback = values.find(v => typeof v === 'string' && v.length > 5);
         return fallback ? String(fallback) : 'Unknown Item';
      }).filter(item => item !== 'Unknown Item');

      setProcessingItems(sampleItems);

      // 2. Analyze with AI
      setStatus(AnalysisStatus.ANALYZING);
      
      // Small delay to allow UI to update
      await new Promise(r => setTimeout(r, 500));

      const analysis = await analyzeBOM(rawRows, apiKey, modelName, maxRetries, (msg) => {
         setRetryMessage(msg);
      });
      
      setResults(analysis);
      setStatus(AnalysisStatus.COMPLETE);
    } catch (err: any) {
      console.error(err);
      setStatus(AnalysisStatus.ERROR);
      setErrorMsg(err.message || "An unexpected error occurred.");
    }
  }, [apiKey, modelName, maxRetries]);

  const handleReset = () => {
      setStatus(AnalysisStatus.IDLE);
      setResults([]);
      setErrorMsg(null);
      setProcessingItems([]);
      setRetryMessage(null);
  };

  const handleUpdateResults = (newResults: PowerAnalysisResult[]) => {
    setResults(newResults);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col font-sans text-slate-200">
      <Header />
      
      <main className="flex-grow flex flex-col">
        {/* Fix: Check for not COMPLETE to allow ERROR state to be handled in this block */}
        {status !== AnalysisStatus.COMPLETE ? (
           <div className="flex-grow flex flex-col items-center justify-center px-4 py-10">
              <div className="w-full max-w-3xl">
                 <div className="text-center mb-8">
                    <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
                      Power Budgeting, <span className="text-emerald-400">Solved.</span>
                    </h1>
                    <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                      Upload your IT Project BOM (Excel/CSV). Our AI identifies datasheets, estimates component power draw, and calculates your total facility load instantly.
                    </p>
                 </div>

                 <div className="w-full max-w-md mx-auto mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-sm col-span-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                            OpenRouter API Key
                        </label>
                        <div className="relative">
                            <input 
                                type="password" 
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="sk-or-..."
                                className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 pr-10 transition-colors"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <Key className="w-4 h-4 text-slate-500" />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Your key is used directly from your browser and is not stored.
                        </p>
                    </div>
                    
                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-sm col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                            Max Retries
                        </label>
                        <div className="relative">
                            <input 
                                type="number"
                                min="1"
                                max="10" 
                                value={maxRetries}
                                onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
                                className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 pr-10 transition-colors"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <RefreshCw className="w-4 h-4 text-slate-500" />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Attempts on error.
                        </p>
                    </div>

                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-sm col-span-3">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                            LLM Model
                        </label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={modelName}
                                onChange={(e) => setModelName(e.target.value)}
                                placeholder="google/gemini-2.0-flash-001"
                                className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 pr-10 transition-colors"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <Cpu className="w-4 h-4 text-slate-500" />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Enter the OpenRouter model ID (e.g. openai/gpt-4o, anthropic/claude-3-opus).
                        </p>
                    </div>
                 </div>
                 
                 <div className={`${!apiKey ? 'opacity-50 pointer-events-none grayscale' : ''} transition-all duration-500`}>
                    <UploadZone 
                        onFileSelected={handleFileSelect} 
                        isProcessing={status === AnalysisStatus.PARSING || status === AnalysisStatus.ANALYZING} 
                        processingItems={processingItems}
                        retryMessage={retryMessage}
                    />
                 </div>

                 {status === AnalysisStatus.ERROR && (
                    <div className="mt-6 p-4 bg-red-900/20 border border-red-800 rounded-lg text-center max-w-xl mx-auto">
                       <p className="text-red-400 font-medium">Analysis Failed</p>
                       <p className="text-sm text-red-300/70 mt-1">{errorMsg}</p>
                       <button onClick={handleReset} className="mt-3 text-sm text-white underline hover:text-red-200">Try Again</button>
                    </div>
                 )}
              </div>
           </div>
        ) : (
           <Dashboard 
             results={results} 
             onReset={handleReset} 
             onUpdateResults={handleUpdateResults} 
             apiKey={apiKey} 
             modelName={modelName}
             maxRetries={maxRetries}
           />
        )}
      </main>

      <footer className="bg-slate-950 py-6 border-t border-slate-900">
         <div className="max-w-7xl mx-auto px-4 text-center text-slate-600 text-xs">
            &copy; {new Date().getFullYear()} WattWise. AI estimates are for reference only. Always verify with official manufacturer engineering specifications.
         </div>
      </footer>
    </div>
  );
};

export default App;
