
import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { csvParse } from 'd3-dsv';
import { FileData } from '../types';

interface DataVisualizerProps {
  file: FileData | null;
  onClose: () => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const DataVisualizer: React.FC<DataVisualizerProps> = ({ file, onClose }) => {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [xAxis, setXAxis] = useState<string>('');
  const [yAxis, setYAxis] = useState<string>('');
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    if (file && file.content) {
      try {
        const data = csvParse(file.content);
        if (data.length > 0) {
          setParsedData(data);
          const cols = Object.keys(data[0]);
          setColumns(cols);
          setXAxis(cols[0]);
          // Try to find a numeric column for Y axis
          const numericCol = cols.find(c => !isNaN(Number(data[0][c]))) || cols[1] || cols[0];
          setYAxis(numericCol);
        }
      } catch (err) {
        console.error("Failed to parse CSV", err);
      }
    }
  }, [file]);

  const chartData = useMemo(() => {
    return parsedData.map(d => ({
      ...d,
      [yAxis]: parseFloat(d[yAxis]) || 0
    })).slice(0, 50); // Limit to 50 items for performance/readability
  }, [parsedData, yAxis]);

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
              <i className="fa-solid fa-chart-column"></i>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Data Visualization</h3>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                Source: {file.name}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Controls Sidebar */}
          <div className="w-full md:w-72 border-r border-slate-100 p-6 space-y-6 overflow-y-auto bg-slate-50/50">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Chart Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(['bar', 'line', 'pie'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setChartType(type)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                      chartType === type 
                        ? 'bg-blue-600 border-blue-600 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'
                    }`}
                  >
                    <i className={`fa-solid fa-chart-${type === 'pie' ? 'pie' : type === 'bar' ? 'column' : 'line'} mb-1`}></i>
                    <span className="text-[10px] font-bold capitalize">{type}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Dimension (X-Axis)</label>
              <select 
                value={xAxis}
                onChange={(e) => setXAxis(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Measure (Y-Axis)</label>
              <select 
                value={yAxis}
                onChange={(e) => setYAxis(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                <i className="fa-solid fa-circle-info mr-1"></i>
                Visualizing top 50 records. Non-numeric values in the Measure column will be treated as 0.
              </p>
            </div>
          </div>

          {/* Chart Display Area */}
          <div className="flex-1 p-8 bg-white flex flex-col min-h-0">
            <div className="flex-1 min-h-0">
              {parsedData.length > 0 ? (
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
                      <Legend verticalAlign="top" height={36}/>
                      <Bar dataKey={yAxis} fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
                      <Legend verticalAlign="top" height={36}/>
                      <Line type="monotone" dataKey={yAxis} stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  ) : (
                    <PieChart>
                      <Pie
                        data={chartData.slice(0, 10)} // Pie charts get messy with too many slices
                        dataKey={yAxis}
                        nameKey={xAxis}
                        cx="50%"
                        cy="50%"
                        outerRadius={150}
                        fill="#8884d8"
                        label={({name, percent}) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <i className="fa-solid fa-table text-5xl mb-4 opacity-20"></i>
                  <p className="font-medium">No valid tabular data found to visualize.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] text-slate-400 font-medium px-2">
            Interactive visualization powered by OmniDoc Engine
          </p>
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-sm transition-all"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataVisualizer;
