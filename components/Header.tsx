import React from 'react';
import { Zap } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Zap className="h-8 w-8 text-emerald-400" />
            </div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <span className="text-white text-xl font-bold tracking-tight">WattWise</span>
                <span className="text-slate-400 text-sm font-medium">BOM Power Analyzer</span>
              </div>
            </div>
          </div>
          <div>
             <div className="text-xs text-slate-500 border border-slate-700 rounded px-2 py-1">
                Powered by OpenRouter
             </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;