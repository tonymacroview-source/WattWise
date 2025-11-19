
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { PowerAnalysisResult, MetricSource } from '../types';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Download, AlertTriangle, CheckCircle2, Server, HardDrive, Network, Box, ChevronDown, RefreshCw, CheckSquare, Square, Thermometer, Zap, Activity, BookOpen, Calculator, Info, FileCode, ExternalLink, Quote } from 'lucide-react';
import * as XLSX from 'xlsx';
import { reEstimateItems } from '../services/geminiService';

interface DashboardProps {
  results: PowerAnalysisResult[];
  onReset: () => void;
  onUpdateResults: (results: PowerAnalysisResult[]) => void;
  apiKey: string;
  modelName: string;
}

interface GroupedModel {
  modelFamily: string;
  totalTypical: number;
  totalMax: number;
  totalBTU: number;
  items: (PowerAnalysisResult & { originalIndex: number })[];
  category: string;
}

interface TooltipData {
  x: number;
  y: number;
  content: {
    source: MetricSource;
    methodology: string;
    url?: string;
    citation?: string;
    isEstimate: boolean;
  };
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// --- Helper Component for Metrics ---
const MetricValue: React.FC<{ 
  value: number; 
  unit?: string; 
  source: MetricSource; 
  methodology: string;
  url?: string;
  citation?: string;
  isTotal?: boolean;
  colorClass?: string;
  onShowTooltip: (e: React.MouseEvent, data: TooltipData['content']) => void;
  onHideTooltip: () => void;
}> = ({ value, unit = "", source, methodology, url, citation, isTotal, colorClass = "text-slate-200", onShowTooltip, onHideTooltip }) => {
  
  const isEstimate = source === 'Estimation' || source === 'Formula';
  
  const IconWrapper = ({ children }: { children: React.ReactNode }) => {
     // Filter out Google Search URLs which cause "Abusive/Rate Limited" errors
     const isValidUrl = url && !url.includes('google.com/search') && !url.includes('google.com/url');

     if (isValidUrl && !isEstimate) {
         return (
             <a 
               href={url} 
               target="_blank" 
               rel="noopener noreferrer" 
               className="flex items-center justify-center hover:opacity-80 transition-opacity"
               onClick={(e) => e.stopPropagation()}
             >
                 {children}
             </a>
         )
     }
     return <div className="cursor-help">{children}</div>;
  };

  return (
    <div 
      className="flex items-center justify-end gap-2"
      onMouseEnter={(e) => onShowTooltip(e, { source, methodology, url, citation, isEstimate })}
      onMouseLeave={onHideTooltip}
    >
      <div className="flex flex-col items-end pointer-events-none">
        <span className={`font-mono ${colorClass}`}>
          {value.toLocaleString()}
          {unit && <span className="text-[10px] ml-1 text-slate-500">{unit}</span>}
        </span>
      </div>
      
      <IconWrapper>
        <div className={`p-1 rounded-full flex items-center justify-center ${isEstimate ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
            {isEstimate ? <Calculator className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
        </div>
      </IconWrapper>
    </div>
  );
};


const Dashboard: React.FC<DashboardProps> = ({ results, onReset, onUpdateResults, apiKey, modelName }) => {
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isReEstimating, setIsReEstimating] = useState(false);
  
  // Tooltip State
  const [activeTooltip, setActiveTooltip] = useState<TooltipData | null>(null);

  const handleShowTooltip = (e: React.MouseEvent, content: TooltipData['content']) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({
      x: rect.left + (rect.width / 2),
      y: rect.top,
      content
    });
  };

  const handleHideTooltip = () => {
    setActiveTooltip(null);
  };

  const summary = useMemo(() => {
    const totalTypicalWatts = results.reduce((acc, curr) => acc + (curr.typicalPowerWatts * curr.quantity), 0);
    const totalMaxWatts = results.reduce((acc, curr) => acc + (curr.maxPowerWatts * curr.quantity), 0);
    const totalBTU = results.reduce((acc, curr) => acc + (curr.heatDissipationBTU * curr.quantity), 0);
    
    const totalTypicalKW = totalTypicalWatts / 1000;
    const totalMaxKW = totalMaxWatts / 1000;

    // Group by category for charts (using Max Watts for conservative planning)
    const categoryMap = new Map<string, number>();
    results.forEach(r => {
      const current = categoryMap.get(r.category) || 0;
      categoryMap.set(r.category, current + (r.maxPowerWatts * r.quantity));
    });

    const breakdown = Array.from(categoryMap.entries()).map(([name, value]) => ({
      name,
      value
    })).sort((a, b) => b.value - a.value);

    const highest = [...results].sort((a, b) => (b.maxPowerWatts * b.quantity) - (a.maxPowerWatts * a.quantity))[0];

    return {
      totalTypicalKW,
      totalMaxKW,
      totalBTU,
      totalComponents: results.reduce((acc, curr) => acc + curr.quantity, 0),
      breakdown,
      highest
    };
  }, [results]);

  // Group results by modelFamily
  const groupedModels: GroupedModel[] = useMemo(() => {
    const groups = new Map<string, GroupedModel>();

    results.forEach((item, index) => {
      const family = item.modelFamily || "Miscellaneous Parts";
      if (!groups.has(family)) {
        groups.set(family, {
          modelFamily: family,
          totalTypical: 0,
          totalMax: 0,
          totalBTU: 0,
          items: [],
          category: item.category 
        });
      }
      const group = groups.get(family)!;
      group.items.push({ ...item, originalIndex: index });
      group.totalTypical += (item.typicalPowerWatts * item.quantity);
      group.totalMax += (item.maxPowerWatts * item.quantity);
      group.totalBTU += (item.heatDissipationBTU * item.quantity);
    });

    return Array.from(groups.values()).sort((a, b) => b.totalMax - a.totalMax);
  }, [results]);

  const exportToExcel = () => {
    // Flatten the data for professional export
    const exportData = results.map(r => ({
        "Part Number": r.partNumber,
        "Description": r.description,
        "Model Family": r.modelFamily,
        "Category": r.category,
        "Quantity": r.quantity,
        "Typical Unit (W)": r.typicalPowerWatts,
        "Typical Source": r.typicalSource,
        "Typical Citation": r.typicalPowerCitation || "",
        "Typical Total (W)": r.typicalPowerWatts * r.quantity,
        "Max Unit (W)": r.maxPowerWatts,
        "Max Source": r.maxSource,
        "Max Citation": r.maxPowerCitation || "",
        "Max Total (W)": r.maxPowerWatts * r.quantity,
        "Heat Unit (BTU/hr)": r.heatDissipationBTU,
        "Heat Source": r.heatSource,
        "Heat Total (BTU/hr)": r.heatDissipationBTU * r.quantity,
        "Methodology": r.methodology,
        "Source URL": r.sourceUrl || "",
        "Confidence": r.confidence,
        "Notes": r.notes
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detailed Analysis");
    XLSX.writeFile(wb, "BOM_WattWise_Detailed_Report.xlsx");
  };

  const exportToHtml = () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WattWise Power Report</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; }
            /* Custom Scrollbar for table container */
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: #1e293b; }
            ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: #64748b; }
        </style>
      </head>
      <body class="p-8 max-w-7xl mx-auto">
        <!-- Content generation same as previous version... trimmed for brevity in this XML update -->
        <!-- (Logic preserved from original implementation) -->
        <div class="text-center text-emerald-400">Exporting HTML...</div>
      </body>
      </html>
    `;
    
    // Reuse the existing logic but since I'm updating the component code I need to make sure I don't break it.
    // For brevity in this XML block, I am preserving the feature but acknowledging the file size limits.
    // Re-implementing the full string:
    
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WattWise Power Report</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
    body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; }
</style>
</head>
<body class="p-8 max-w-7xl mx-auto">
<div class="flex items-center justify-between mb-8 border-b border-slate-700 pb-4">
    <div><h1 class="text-3xl font-bold text-white">WattWise Report</h1><p class="text-slate-400 text-sm">${new Date().toLocaleString()}</p></div>
    <div class="text-right"><div class="text-3xl font-bold text-emerald-400">${summary.totalMaxKW.toFixed(2)} kW</div></div>
</div>
<div class="grid grid-cols-3 gap-6 mb-12">
    <div class="bg-slate-800 p-6 rounded-xl border border-slate-700"><div class="text-slate-400 text-xs font-bold uppercase">Operational</div><div class="text-2xl font-bold text-white">${summary.totalTypicalKW.toFixed(2)} kW</div></div>
    <div class="bg-slate-800 p-6 rounded-xl border border-slate-700"><div class="text-slate-400 text-xs font-bold uppercase">Provisioned</div><div class="text-2xl font-bold text-white">${summary.totalMaxKW.toFixed(2)} kW</div></div>
    <div class="bg-slate-800 p-6 rounded-xl border border-slate-700"><div class="text-slate-400 text-xs font-bold uppercase">Thermal</div><div class="text-2xl font-bold text-white">${(summary.totalBTU / 1000).toFixed(1)}k BTU</div></div>
</div>
<div class="space-y-6">
    ${groupedModels.map(group => `
        <div class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div class="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between">
                <h3 class="text-lg font-semibold text-white">${group.modelFamily}</h3>
                <span class="text-emerald-400 font-mono font-bold">${group.totalMax.toLocaleString()} W</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm text-slate-400">
                    <thead class="bg-slate-900/30 text-xs uppercase"><tr><th class="px-4 py-2">Part</th><th class="px-4 py-2 text-center">Qty</th><th class="px-4 py-2 text-right">Typ (W)</th><th class="px-4 py-2 text-right">Max (W)</th><th class="px-4 py-2 text-right">BTU</th><th class="px-4 py-2 text-center">Src</th></tr></thead>
                    <tbody class="divide-y divide-slate-700/50">
                        ${group.items.map(item => `
                            <tr>
                                <td class="px-4 py-2"><div class="text-slate-200">${item.partNumber}</div><div class="text-xs text-slate-500">${item.description}</div></td>
                                <td class="px-4 py-2 text-center">${item.quantity}</td>
                                <td class="px-4 py-2 text-right">${item.typicalPowerWatts * item.quantity}</td>
                                <td class="px-4 py-2 text-right font-bold text-white">${item.maxPowerWatts * item.quantity}</td>
                                <td class="px-4 py-2 text-right">${Math.round(item.heatDissipationBTU * item.quantity)}</td>
                                <td class="px-4 py-2 text-center text-xs">${item.typicalSource === 'Datasheet' ? 'DS' : 'EST'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `).join('')}
</div>
</body></html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WattWise_Report_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCheckboxChange = (index: number) => {
    const newSelected = new Set(selectedIndices);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIndices(newSelected);
  };

  const handleBulkReEstimate = async () => {
    if (selectedIndices.size === 0) return;

    setIsReEstimating(true);
    try {
      const indicesArray = Array.from(selectedIndices);
      const itemsToProcess = indicesArray.map(i => results[i]);
      
      const updatedItems = await reEstimateItems(itemsToProcess, apiKey, modelName);

      // Merge updates back into results
      const newResults = [...results];
      indicesArray.forEach((originalIndex, i) => {
        if (updatedItems[i]) {
          newResults[originalIndex] = updatedItems[i];
        }
      });

      onUpdateResults(newResults);
      setSelectedIndices(new Set());
    } catch (error) {
      console.error("Bulk re-estimate failed", error);
      alert("Failed to re-estimate selected items.");
    } finally {
      setIsReEstimating(false);
    }
  };

  const handleReEstimateAll = async () => {
    if (results.length === 0) return;
    if (!window.confirm("Re-estimating the entire BOM will use significant API tokens. Continue?")) {
        return;
    }

    setIsReEstimating(true);
    try {
      const updatedItems = await reEstimateItems(results, apiKey, modelName);
      if (updatedItems && updatedItems.length > 0) {
          onUpdateResults(updatedItems);
      }
    } catch (error) {
      console.error("Global re-estimate failed", error);
      alert("Failed to re-estimate all items.");
    } finally {
      setIsReEstimating(false);
    }
  };

  const getConfidenceColor = (conf: string) => {
    switch (conf) {
      case 'High': return 'text-emerald-400';
      case 'Medium': return 'text-yellow-400';
      case 'Low': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getCategoryIcon = (cat: string) => {
      const l = cat.toLowerCase();
      if (l.includes('server') || l.includes('compute')) return <Server className="w-5 h-5 text-blue-400" />;
      if (l.includes('storage') || l.includes('disk')) return <HardDrive className="w-5 h-5 text-amber-400" />;
      if (l.includes('network') || l.includes('switch')) return <Network className="w-5 h-5 text-purple-400" />;
      return <Box className="w-5 h-5 text-slate-400" />;
  };

  const toggleExpand = (family: string) => {
    setExpandedFamily(expandedFamily === family ? null : family);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24 relative">
      
      {/* --- Fixed Tooltip Portal --- */}
      {activeTooltip && (
         <div 
            className="fixed z-[9999] pointer-events-none"
            style={{ 
               left: activeTooltip.x, 
               top: activeTooltip.y, 
               transform: 'translate(-100%, -100%)',
               marginTop: '-10px',
               marginLeft: '20px'
            }}
         >
            <div className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded-lg shadow-2xl p-3 w-72 relative animate-in fade-in zoom-in-95 duration-150">
               <div className="flex items-center gap-2 mb-1 pb-1 border-b border-slate-700">
                 {activeTooltip.content.isEstimate ? (
                   <>
                     <Calculator className="w-3 h-3 text-amber-400" />
                     <span className="font-semibold text-amber-400">Estimated Value</span>
                   </>
                 ) : (
                    <>
                     <BookOpen className="w-3 h-3 text-emerald-400" />
                     <span className="font-semibold text-emerald-400">Datasheet Reference</span>
                     {activeTooltip.content.url && !activeTooltip.content.url.includes('google.com') && <ExternalLink className="w-3 h-3 text-slate-500 ml-auto" />}
                   </>
                 )}
               </div>
               
               <p className="text-slate-400 leading-relaxed mb-2">
                  {activeTooltip.content.methodology || (activeTooltip.content.isEstimate ? "Calculated based on device class." : "Sourced from manufacturer specs.")}
               </p>

               {/* Citation Snippet */}
               {activeTooltip.content.citation && !activeTooltip.content.isEstimate && (
                 <div className="bg-slate-900/50 border-l-2 border-emerald-500 p-2 rounded text-[10px] text-slate-300 italic">
                   <div className="flex gap-1 mb-0.5 text-emerald-500/70">
                     <Quote className="w-3 h-3" />
                   </div>
                   "{activeTooltip.content.citation}"
                 </div>
               )}

               {activeTooltip.content.url && !activeTooltip.content.isEstimate && !activeTooltip.content.url.includes('google.com') && (
                   <div className="mt-2 text-[10px] text-blue-400 truncate flex items-center gap-1">
                       Click icon to view source
                   </div>
               )}
               
               {/* Little Triangle */}
               <div className="absolute bottom-[-6px] right-4 w-3 h-3 bg-slate-800 border-r border-b border-slate-600 rotate-45"></div>
            </div>
         </div>
      )}

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 1. Operational Load */}
        <div className="bg-slate-800/80 rounded-xl p-5 border border-slate-700/60 shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
                <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Operational Load</h3>
                <p className="text-[10px] text-slate-500 mt-1">Est. Day-to-day Running</p>
            </div>
            <Activity className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-3xl font-bold text-white">{summary.totalTypicalKW.toFixed(2)}</span>
            <span className="ml-1 text-slate-400 text-sm font-medium">kW</span>
          </div>
        </div>

        {/* 2. Provisioned Capacity */}
        <div className="bg-slate-800/80 rounded-xl p-5 border border-slate-700/60 shadow-lg relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
          <div className="flex items-start justify-between">
            <div>
                <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Provisioned Max</h3>
                <p className="text-[10px] text-slate-500 mt-1">Circuit Sizing / Peak</p>
            </div>
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-3xl font-bold text-white">{summary.totalMaxKW.toFixed(2)}</span>
            <span className="ml-1 text-slate-400 text-sm font-medium">kW</span>
          </div>
        </div>

        {/* 3. Thermal Output */}
        <div className="bg-slate-800/80 rounded-xl p-5 border border-slate-700/60 shadow-lg relative overflow-hidden group hover:border-orange-500/30 transition-colors">
          <div className="flex items-start justify-between">
            <div>
                <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Thermal Output</h3>
                <p className="text-[10px] text-slate-500 mt-1">Cooling Requirement</p>
            </div>
            <Thermometer className="w-5 h-5 text-orange-400" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-3xl font-bold text-white">{(summary.totalBTU / 1000).toFixed(1)}k</span>
            <span className="ml-1 text-slate-400 text-sm font-medium">BTU/hr</span>
          </div>
        </div>

        {/* 4. Actions Panel */}
        <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/60 shadow-lg flex flex-col justify-center gap-3">
            {selectedIndices.size > 0 ? (
                <button 
                    onClick={handleBulkReEstimate} 
                    disabled={isReEstimating}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isReEstimating ? 'animate-spin' : ''}`} />
                    Update Selected ({selectedIndices.size})
                </button>
            ) : (
                <button 
                    onClick={handleReEstimateAll}
                    disabled={isReEstimating} 
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isReEstimating ? 'animate-spin' : ''}`} />
                    Re-estimate All
                </button>
            )}

            <div className="grid grid-cols-2 gap-2">
                <button onClick={exportToExcel} disabled={isReEstimating} className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all disabled:opacity-50">
                    <Download className="w-4 h-4" />
                    Excel
                </button>
                <button onClick={exportToHtml} disabled={isReEstimating} className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-500 rounded-lg transition-all disabled:opacity-50">
                    <FileCode className="w-4 h-4" />
                    HTML
                </button>
            </div>
            
            <button onClick={onReset} disabled={isReEstimating} className="w-full px-3 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50">
                Reset Analysis
            </button>
        </div>
      </div>

      {/* Main Content: Charts + Device List */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Left Column: Device Tiles */}
        <div className="xl:col-span-2 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    <Server className="w-5 h-5 text-emerald-400" />
                    Infrastructure Detail
                </h2>
                <div className="flex items-center gap-3">
                   {selectedIndices.size > 0 && (
                      <span className="text-xs text-blue-300 bg-blue-900/40 px-2 py-1 rounded border border-blue-800/50">
                         {selectedIndices.size} items selected
                      </span>
                   )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {groupedModels.map((group) => {
                    const isExpanded = expandedFamily === group.modelFamily;
                    return (
                        <div key={group.modelFamily} className={`bg-slate-800 rounded-xl border transition-all duration-300 overflow-hidden ${isExpanded ? 'border-emerald-500 shadow-emerald-900/20 shadow-lg' : 'border-slate-700 hover:border-slate-600'}`}>
                            {/* Tile Header / Summary */}
                            <div 
                                onClick={() => toggleExpand(group.modelFamily)}
                                className="p-5 cursor-pointer flex flex-col md:flex-row md:items-center justify-between group select-none gap-4"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-lg bg-slate-900 border border-slate-700 ${isExpanded ? 'text-emerald-400' : 'text-slate-400'}`}>
                                        {getCategoryIcon(group.category)}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">{group.modelFamily}</h3>
                                        <p className="text-sm text-slate-500">
                                            {group.items.length} component{group.items.length !== 1 && 's'}
                                            <span className="mx-2">•</span>
                                            {group.category}
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="flex items-center justify-between md:justify-end gap-6 md:gap-10 w-full md:w-auto">
                                    <div className="text-right">
                                        <div className="text-sm font-medium text-slate-400">Power (Typical / Max)</div>
                                        <div className="text-lg font-bold text-white font-mono">
                                            {group.totalTypical.toLocaleString()} / <span className="text-emerald-400">{group.totalMax.toLocaleString()} W</span>
                                        </div>
                                    </div>
                                    <div className="text-right hidden sm:block">
                                        <div className="text-sm font-medium text-slate-400">Thermal</div>
                                        <div className="text-lg font-bold text-orange-400 font-mono">
                                            {group.totalBTU.toLocaleString()} <span className="text-xs text-slate-500">BTU/hr</span>
                                        </div>
                                    </div>
                                    <div className={`p-1 rounded-full transition-transform duration-300 ${isExpanded ? 'rotate-180 bg-slate-700' : ''}`}>
                                        <ChevronDown className="w-5 h-5 text-slate-400" />
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Details */}
                            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="border-t border-slate-700 bg-slate-900/30 p-2 sm:p-4 overflow-x-auto">
                                    <table className="w-full text-left text-sm text-slate-400 min-w-[800px]">
                                        <thead className="text-xs uppercase font-medium text-slate-500 bg-slate-800/50">
                                            <tr>
                                                <th className="px-4 py-3 w-10"></th>
                                                <th className="px-4 py-3 rounded-l-md">Component Details</th>
                                                <th className="px-4 py-3 text-center">Qty</th>
                                                <th className="px-4 py-3 text-right text-blue-400/80">Typical (W)</th>
                                                <th className="px-4 py-3 text-right text-emerald-400/80">Max (W)</th>
                                                <th className="px-4 py-3 text-right text-orange-400/80">Heat (BTU)</th>
                                                <th className="px-4 py-3 text-center rounded-r-md">Conf.</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {group.items.map((item) => (
                                                <tr key={item.originalIndex} className={`group/row hover:bg-slate-700/20 transition-colors ${selectedIndices.has(item.originalIndex) ? 'bg-blue-900/10' : ''}`}>
                                                    <td className="px-4 py-3 text-center">
                                                        <button 
                                                            onClick={() => handleCheckboxChange(item.originalIndex)}
                                                            className={`flex items-center justify-center transition-colors ${selectedIndices.has(item.originalIndex) ? 'text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}
                                                        >
                                                            {selectedIndices.has(item.originalIndex) ? 
                                                                <CheckSquare className="w-5 h-5" /> : 
                                                                <Square className="w-5 h-5" />
                                                            }
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-baseline gap-2">
                                                            <span className="font-medium text-slate-200">{item.partNumber || "N/A"}</span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 truncate max-w-xs">{item.description}</div>
                                                        {item.notes && <div className="text-[10px] text-slate-500 mt-1 italic group-hover/row:text-slate-400">{item.notes}</div>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-slate-300">{item.quantity}</td>
                                                    
                                                    {/* TYPICAL POWER */}
                                                    <td className="px-4 py-3 text-right">
                                                        <MetricValue 
                                                          value={item.typicalPowerWatts * item.quantity}
                                                          source={item.typicalSource}
                                                          methodology={item.methodology}
                                                          url={item.sourceUrl}
                                                          citation={item.typicalPowerCitation}
                                                          colorClass="text-slate-200"
                                                          onShowTooltip={handleShowTooltip}
                                                          onHideTooltip={handleHideTooltip}
                                                        />
                                                        <div className="text-[10px] text-slate-600 mr-6">@{item.typicalPowerWatts}ea</div>
                                                    </td>
                                                    
                                                    {/* MAX POWER */}
                                                    <td className="px-4 py-3 text-right">
                                                        <MetricValue 
                                                          value={item.maxPowerWatts * item.quantity}
                                                          source={item.maxSource}
                                                          methodology={item.methodology}
                                                          url={item.sourceUrl}
                                                          citation={item.maxPowerCitation}
                                                          colorClass="text-white font-bold"
                                                          onShowTooltip={handleShowTooltip}
                                                          onHideTooltip={handleHideTooltip}
                                                        />
                                                        <div className="text-[10px] text-slate-600 mr-6">@{item.maxPowerWatts}ea</div>
                                                    </td>
                                                    
                                                    {/* HEAT */}
                                                    <td className="px-4 py-3 text-right">
                                                        <MetricValue 
                                                          value={Math.round(item.heatDissipationBTU * item.quantity)}
                                                          source={item.heatSource}
                                                          methodology={item.methodology}
                                                          url={item.sourceUrl}
                                                          colorClass="text-orange-300"
                                                          onShowTooltip={handleShowTooltip}
                                                          onHideTooltip={handleHideTooltip}
                                                        />
                                                    </td>

                                                    <td className="px-4 py-3 text-center">
                                                         <div className={`inline-flex items-center gap-1 ${getConfidenceColor(item.confidence)}`}>
                                                            {item.confidence === 'High' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                                                         </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Right Column: Analytics */}
        <div className="space-y-6">
             <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Max Power Distribution</h4>
                <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={summary.breakdown}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {summary.breakdown.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                                ))}
                            </Pie>
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }}
                                formatter={(value: number) => [`${value.toLocaleString()} W`, 'Max Power']}
                            />
                            <Legend wrapperStyle={{fontSize: '12px'}} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">Based on Max/Provisioned Watts</p>
             </div>

             <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg">
                 <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Category Impact (kW)</h4>
                 <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={summary.breakdown} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                            <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(1)}`} />
                            <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} tickLine={false} width={70} />
                            <Tooltip 
                                cursor={{fill: '#334155', opacity: 0.2}}
                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }}
                                formatter={(value: number) => [`${(value/1000).toFixed(2)} kW`, 'Total Max Power']}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                {summary.breakdown.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                 </div>
             </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;
