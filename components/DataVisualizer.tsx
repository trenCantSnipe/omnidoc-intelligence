
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Sector
} from 'recharts';
import { csvParse } from 'd3-dsv';
import { FileData } from '../types';
import { analyzeFiles } from '../services/gemini';

interface DataVisualizerProps {
  file: FileData | null;
  onClose: () => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const renderActiveShape = (props: any) => {
  const RADIAN = Math.PI / 180;
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  const sin = Math.sin(-RADIAN * midAngle);
  const cos = Math.cos(-RADIAN * midAngle);
  const sx = cx + (outerRadius + 10) * cos;
  const sy = cy + (outerRadius + 10) * sin;
  const mx = cx + (outerRadius + 30) * cos;
  const my = cy + (outerRadius + 30) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 22;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} className="font-bold text-lg">
        {payload.name}
      </text>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 12}
        outerRadius={outerRadius + 15}
        fill={fill}
      />
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
      <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
      <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} textAnchor={textAnchor} fill="#333" className="text-xs font-bold">{`Value: ${value}`}</text>
      <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} dy={18} textAnchor={textAnchor} fill="#999" className="text-[10px]">
        {`(${(percent * 100).toFixed(2)}%)`}
      </text>
    </g>
  );
};

const DataVisualizer: React.FC<DataVisualizerProps> = ({ file, onClose }) => {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [xAxis, setXAxis] = useState<string>('');
  const [selectedMeasures, setSelectedMeasures] = useState<string[]>([]);
  const [hiddenMeasures, setHiddenMeasures] = useState<Set<string>>(new Set());
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [pieActiveIndex, setPieActiveIndex] = useState<number>(0);

  // Range Filtering States
  const [minInput, setMinInput] = useState<string>('');
  const [maxInput, setMaxInput] = useState<string>('');
  const [activeMin, setActiveMin] = useState<number | null>(null);
  const [activeMax, setActiveMax] = useState<number | null>(null);

  // AI Trend Analysis States
  const [aiTrendSummary, setAiTrendSummary] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  useEffect(() => {
    if (file && file.content) {
      try {
        const data = csvParse(file.content);
        if (data.length > 0) {
          setParsedData(data);
          const cols = Object.keys(data[0]);
          setColumns(cols);
          setXAxis(cols[0]);
          const numericCols = cols.filter(c => data.some(row => !isNaN(Number(row[c])) && row[c] !== ''));
          const initialMeasure = numericCols.length > 0 ? numericCols[0] : (cols[1] || cols[0]);
          setSelectedMeasures([initialMeasure]);
        }
      } catch (err) {
        console.error("Failed to parse CSV", err);
      }
    }
  }, [file]);

  // Debouncing Range Inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveMin(minInput === '' ? null : parseFloat(minInput));
      setActiveMax(maxInput === '' ? null : parseFloat(maxInput));
    }, 400);
    return () => clearTimeout(timer);
  }, [minInput, maxInput]);

  const chartData = useMemo(() => {
    let data = parsedData.map(d => {
      const row: any = { ...d };
      selectedMeasures.forEach(m => {
        row[m] = parseFloat(d[m]) || 0;
      });
      return row;
    });

    // Apply Filters
    if (activeMin !== null || activeMax !== null) {
      data = data.filter(row => {
        return selectedMeasures.every(m => {
          const val = row[m];
          const passMin = activeMin === null || val >= activeMin;
          const passMax = activeMax === null || val <= activeMax;
          return passMin && passMax;
        });
      });
    }

    return data.slice(0, 50);
  }, [parsedData, selectedMeasures, activeMin, activeMax]);

  const handleLegendClick = (o: any) => {
    const { dataKey } = o;
    setHiddenMeasures(prev => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  const toggleMeasure = (col: string) => {
    setSelectedMeasures(prev => {
      if (prev.includes(col)) {
        if (prev.length === 1) return prev;
        return prev.filter(c => c !== col);
      }
      return [...prev, col];
    });
  };

  const handleAnalyzeTrends = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setAiTrendSummary('');
    try {
      const prompt = `Perform a smart trend analysis on this dataset. 
      1. Calculate the average range for the selected measures: ${selectedMeasures.join(', ')}.
      2. Identify specifically where the data has gone up or down significantly (spikes/dips).
      3. Provide a concise 3-sentence summary of the overall trajectory. 
      Use professional, data-driven language.`;
      
      const response = await analyzeFiles([file], prompt, { useLite: true, isSummaryRequest: true });
      setAiTrendSummary(response.text || "Unable to determine trends at this time.");
    } catch (err) {
      setAiTrendSummary("Analysis failed. Please ensure the file contains valid numeric columns.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!file) return null;

  return (
    <div 
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300"
      role="dialog"
      aria-labelledby="viz-title"
      aria-modal="true"
    >
      <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-emerald-50 text-emerald-600 border border-emerald-100" aria-hidden="true">
              <i className="fa-solid fa-chart-column"></i>
            </div>
            <div>
              <h3 id="viz-title" className="text-lg font-bold text-slate-900">Data Visualization</h3>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                Source: {file.name}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all focus:ring-2 focus:ring-blue-500 outline-none"
            aria-label="Close Data Visualizer"
          >
            <i className="fa-solid fa-xmark text-lg" aria-hidden="true"></i>
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Controls Sidebar */}
          <aside className="w-full md:w-80 border-r border-slate-100 p-6 space-y-6 overflow-y-auto bg-slate-50/50" aria-label="Chart Controls">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Chart Type</label>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Select Visualization Type">
                {(['bar', 'line', 'pie'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setChartType(type)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all focus:ring-2 focus:ring-blue-500 outline-none ${
                      chartType === type 
                        ? 'bg-blue-600 border-blue-600 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'
                    }`}
                    aria-pressed={chartType === type}
                  >
                    <i className={`fa-solid fa-chart-${type === 'pie' ? 'pie' : type === 'bar' ? 'column' : 'line'} mb-1`} aria-hidden="true"></i>
                    <span className="text-[10px] font-bold capitalize">{type}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-200">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Precise Range Filter</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-400 font-bold uppercase">Min</span>
                  <input 
                    type="number" 
                    value={minInput}
                    onChange={(e) => setMinInput(e.target.value)}
                    placeholder="Min"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-400 font-bold uppercase">Max</span>
                  <input 
                    type="number" 
                    value={maxInput}
                    onChange={(e) => setMaxInput(e.target.value)}
                    placeholder="Max"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              {(minInput !== '' || maxInput !== '') && (
                <button 
                  onClick={() => { setMinInput(''); setMaxInput(''); }}
                  className="text-[9px] font-bold text-blue-500 hover:text-blue-700 transition-colors uppercase tracking-tight"
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div>
              <label htmlFor="x-axis-select" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Dimension (X-Axis)</label>
              <select 
                id="x-axis-select"
                value={xAxis}
                onChange={(e) => setXAxis(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              >
                {columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Measures (Y-Axis)</label>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2 scrollbar-hide" role="group" aria-label="Toggle Data Measures">
                {columns.map(col => (
                  <label key={col} className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-100 hover:border-blue-200 cursor-pointer transition-all focus-within:ring-2 focus-within:ring-blue-500">
                    <input 
                      type="checkbox" 
                      checked={selectedMeasures.includes(col)}
                      onChange={() => toggleMeasure(col)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-xs font-semibold text-slate-600 truncate">{col}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3">
              <button 
                onClick={handleAnalyzeTrends}
                disabled={isAnalyzing}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-black py-3 rounded-xl hover:bg-blue-600 transition-all shadow-md disabled:bg-slate-200 text-[10px] uppercase tracking-widest"
              >
                {isAnalyzing ? (
                   <i className="fa-solid fa-circle-notch animate-spin"></i>
                ) : (
                   <i className="fa-solid fa-wand-magic-sparkles"></i>
                )}
                Auto-Analyze Trends
              </button>
            </div>
          </aside>

          {/* Chart Display Area */}
          <section className="flex-1 p-8 bg-white flex flex-col min-h-0" aria-label="Interactive Chart Display">
            {aiTrendSummary && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl animate-in slide-in-from-top-2">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fa-solid fa-sparkles text-blue-500 text-xs"></i>
                  <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">AI Trend Insight</span>
                </div>
                <p className="text-xs text-blue-800 leading-relaxed font-medium">
                  {aiTrendSummary}
                </p>
              </div>
            )}
            
            <div className="flex-1 min-h-0">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'bar' ? (
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey={xAxis} 
                        angle={-45} 
                        textAnchor="end" 
                        interval={0} 
                        tick={{fontSize: 10, fontWeight: 500, fill: '#64748b'}} 
                        height={60}
                      />
                      <YAxis tick={{fontSize: 10, fontWeight: 500, fill: '#64748b'}} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontWeight: 700, fontSize: '12px' }}
                      />
                      <Legend verticalAlign="top" height={36} onClick={handleLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {selectedMeasures.map((m, i) => (
                        <Bar 
                          key={m} 
                          dataKey={m} 
                          fill={COLORS[i % COLORS.length]} 
                          hide={hiddenMeasures.has(m)}
                          radius={[4, 4, 0, 0]} 
                        />
                      ))}
                    </BarChart>
                  ) : chartType === 'line' ? (
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey={xAxis} 
                        angle={-45} 
                        textAnchor="end" 
                        interval={0} 
                        tick={{fontSize: 10, fontWeight: 500, fill: '#64748b'}} 
                        height={60}
                      />
                      <YAxis tick={{fontSize: 10, fontWeight: 500, fill: '#64748b'}} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontWeight: 700, fontSize: '12px' }}
                      />
                      <Legend verticalAlign="top" height={36} onClick={handleLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {selectedMeasures.map((m, i) => (
                        <Line 
                          key={m} 
                          type="monotone" 
                          dataKey={m} 
                          stroke={COLORS[i % COLORS.length]} 
                          hide={hiddenMeasures.has(m)}
                          strokeWidth={3} 
                          dot={{ r: 4 }} 
                          activeDot={{ r: 6 }} 
                        />
                      ))}
                    </LineChart>
                  ) : (
                    <PieChart>
                      <Pie
                        activeIndex={pieActiveIndex}
                        activeShape={renderActiveShape}
                        data={chartData.slice(0, 10).map(d => ({ name: d[xAxis], value: d[selectedMeasures[0]] }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={120}
                        paddingAngle={5}
                        dataKey="value"
                        onMouseEnter={(_, index) => setPieActiveIndex(index)}
                      >
                        {chartData.slice(0, 10).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" align="center" />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <i className="fa-solid fa-filter-circle-xmark text-5xl mb-4 opacity-20" aria-hidden="true"></i>
                  <p className="font-medium">No results match your filters.</p>
                  <button onClick={() => { setMinInput(''); setMaxInput(''); }} className="mt-4 text-blue-500 font-bold text-xs uppercase underline">Reset Filters</button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] text-slate-400 font-medium px-2 italic">
            <i className="fa-solid fa-chart-area mr-1"></i>
            Showing {chartData.length} entries of {parsedData.length} total.
          </p>
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-sm transition-all focus:ring-2 focus:ring-slate-400 outline-none"
          >
            Close Viewer
          </button>
        </footer>
      </div>
    </div>
  );
};

export default DataVisualizer;
