import React, { useState, useEffect } from 'react';
import { UploadCloud, FileSpreadsheet, AlertCircle, Zap } from 'lucide-react';

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
}

const LOADING_MESSAGES = [
  "Reading Bill of Materials...",
  "Identifying infrastructure components...",
  "Consulting manufacturer datasheets...",
  "Cross-referencing power specifications...",
  "Calculating thermal loads (BTU/hr)...",
  "Analyzing efficiency curves...",
  "Finalizing power budget report..."
];

const UploadZone: React.FC<UploadZoneProps> = ({ onFileSelected, isProcessing }) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    let interval: any;
    if (isProcessing) {
      setMessageIndex(0);
      interval = setInterval(() => {
        setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessing]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndPassFile = (file: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];
    
    if (validTypes.includes(file.type) || file.name.endsWith('.xlsx') || file.name.endsWith('.csv')) {
      setError(null);
      onFileSelected(file);
    } else {
      setError("Please upload a valid Excel (.xlsx, .xls) or CSV file.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndPassFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      validateAndPassFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-10 p-6">
      <div 
        className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl transition-all duration-300 ease-in-out
          ${dragActive ? "border-emerald-500 bg-emerald-500/10" : "border-slate-600 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-500"}
          ${isProcessing ? "opacity-100 pointer-events-none border-emerald-500/50 bg-slate-900/50" : ""}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4 w-full">
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center w-full animate-in fade-in duration-500">
               <div className="relative w-16 h-16 mb-6">
                 <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
                 <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                 <Zap className="absolute inset-0 m-auto w-6 h-6 text-emerald-400 animate-pulse" />
               </div>
               
               <div className="h-8 flex items-center justify-center overflow-hidden relative w-full">
                  <p 
                    key={messageIndex} 
                    className="text-lg font-medium text-emerald-400 animate-[fadeInUp_0.5s_ease-out]"
                  >
                    {LOADING_MESSAGES[messageIndex]}
                  </p>
               </div>
               
               <p className="text-xs text-slate-500 mt-3">
                 Processing large BOMs may take up to 60 seconds via OpenRouter.
               </p>
            </div>
          ) : (
            <>
              <UploadCloud className={`w-16 h-16 mb-4 ${dragActive ? "text-emerald-400" : "text-slate-400"}`} />
              <p className="mb-2 text-lg text-slate-300 font-medium">
                <span className="font-semibold text-emerald-400">Click to upload</span> or drag and drop
              </p>
              <p className="text-sm text-slate-500">
                Excel (XLSX) or CSV files containing your BOM.
              </p>
              <p className="text-xs text-slate-600 mt-2">
                Make sure columns like "Part Number" or "Description" and "Quantity" exist.
              </p>
            </>
          )}
        </div>
        <input 
          id="dropzone-file" 
          type="file" 
          className="absolute w-full h-full opacity-0 cursor-pointer" 
          onChange={handleChange}
          disabled={isProcessing}
        />
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-800 rounded-lg flex items-center gap-3 text-red-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
           <FileSpreadsheet className="w-6 h-6 mx-auto text-emerald-400 mb-2" />
           <h3 className="text-sm font-semibold text-slate-200">1. Upload BOM</h3>
           <p className="text-xs text-slate-400 mt-1">Raw excel export</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
           <Zap className="w-6 h-6 mx-auto text-emerald-400 mb-2" />
           <h3 className="text-sm font-semibold text-slate-200">2. AI Analysis</h3>
           <p className="text-xs text-slate-400 mt-1">Matches datasheets & specs</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
           <div className="w-6 h-6 mx-auto text-emerald-400 mb-2 font-bold">kW</div>
           <h3 className="text-sm font-semibold text-slate-200">3. Get Report</h3>
           <p className="text-xs text-slate-400 mt-1">Total power budget</p>
        </div>
      </div>
    </div>
  );
};

export default UploadZone;