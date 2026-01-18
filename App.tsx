
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import Layout from './components/Layout';
import Auth from './components/Auth';
import InvoiceForm from './components/InvoiceForm';
import InventoryTable from './components/InventoryTable';
import StatsCard from './components/StatsCard';
import { DateRangePicker } from './components/DateRangePicker'; 
import Toast, { ToastMessage } from './components/Toast'; 
import { Invoice, InventoryBatch, CustomerStat, AgingStats, SupplierStat, RiskAlert, AuditReport } from './types';
import { loadInvoices, resetData } from './services/storeService'; 
import { supabase, saveOrderToSupabase, fetchOrders, deleteOrderFromSupabase, bulkInsertOrders, updateOrderPartyName } from './services/supabase';
import { formatCurrency, formatGrams, getDateDaysAgo, calculateStockAging, calculateSupplierStats, calculateTurnoverStats, generateId, downloadCSV, performFullSystemAudit } from './utils';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  ArrowUpRight, Scale, Coins, Trash2, TrendingUp, AlertTriangle, 
  FileSpreadsheet, FileText, Factory, Lock, ArrowRightLeft, LineChart as LineChartIcon, 
  Download, Users, ChevronRight, ChevronLeft, Crown, Briefcase, 
  Timer, Activity, Wallet, FileDown, CheckCircle, CloudCog, RefreshCw, CloudUpload, Server, Database, Info, Edit2, Eye, FileLock, ShieldCheck, Bug, ShieldAlert
} from 'lucide-react';
import { 
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';

// --- Shared UI Components ---

const Card: React.FC<{ children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode, delay?: number }> = ({ children, className = '', title, action, delay = 0 }) => (
  <div 
    className={`bg-white rounded-3xl border border-slate-100 shadow-card flex flex-col overflow-hidden animate-slide-up ${className}`}
    style={{ animationDelay: `${delay}ms` }}
  >
    {title && (
      <div className="px-8 py-6 border-b border-slate-50 flex flex-wrap justify-between items-center bg-white/50 backdrop-blur-sm sticky top-0 z-10 gap-4">
        <h3 className="font-bold text-slate-900 text-xl tracking-tight flex items-center gap-2">{title}</h3>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-8 flex-1 overflow-auto">{children}</div>
  </div>
);

const SectionHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 animate-slide-up">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{title}</h2>
      {subtitle && <p className="text-slate-500 text-sm mt-1.5 font-medium">{subtitle}</p>}
    </div>
    {action && <div className="flex gap-3 w-full md:w-auto">{action}</div>}
  </div>
);

const ExportMenu: React.FC<{ onExport: (type: 'CSV' | 'PDF') => void }> = ({ onExport }) => (
    <div className="flex gap-2">
        <button onClick={() => onExport('CSV')} className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-all active:scale-95 shadow-sm">
            <FileSpreadsheet className="w-4 h-4" /> CSV
        </button>
        <button onClick={() => onExport('PDF')} className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-slate-900 border border-slate-900 rounded-xl hover:bg-slate-800 transition-all active:scale-95 shadow-lg shadow-slate-900/10">
            <FileText className="w-4 h-4" /> PDF
        </button>
    </div>
);

// Constants for Chart Styling
const TOOLTIP_CONTENT_STYLE = {
    backgroundColor: '#fff',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    outline: 'none'
};

const CHART_MARGIN = { top: 20, right: 0, left: -20, bottom: 0 };

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<InventoryBatch[]>([]);
  const [marketRate, setMarketRate] = useState<string>(''); 
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbError, setDbError] = useState(false);
  
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [isWorkingMode, setIsWorkingMode] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [editNamePassword, setEditNamePassword] = useState('');
  const [newPartyName, setNewPartyName] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [pendingExport, setPendingExport] = useState<(() => void) | null>(null);
  
  const [dateRange, setDateRange] = useState({
      start: getDateDaysAgo(30),
      end: new Date().toISOString().split('T')[0]
  });
  const [lockDate, setLockDate] = useState<string | null>(localStorage.getItem('bullion_lock_date') || null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsWorkingMode(false);
    }
  }, [session]);

  // Global Scroll Handler for Auto-Hiding Scrollbars
  useEffect(() => {
    const scrollTimeouts = new Map<HTMLElement, number>();

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      // Check if the scrolled element is one of our custom scrollbars
      if (target.classList && target.classList.contains('custom-scrollbar')) {
        target.classList.add('is-scrolling');
        
        // Clear existing timeout for this specific element
        const existing = scrollTimeouts.get(target);
        if (existing) clearTimeout(existing);

        // Set new timeout to fade out
        const timeout = window.setTimeout(() => {
          target.classList.remove('is-scrolling');
          scrollTimeouts.delete(target);
        }, 800); // 800ms delay before fade out starts
        
        scrollTimeouts.set(target, timeout);
      }
    };

    // Capture phase ensures we catch scroll events from any child container
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      scrollTimeouts.forEach(t => clearTimeout(t));
    };
  }, []);

  const addToast = (type: 'SUCCESS' | 'ERROR', message: string) => {
      const id = generateId();
      setToasts(prev => [...prev, { id, type, message }]);
  };
  const removeToast = (id: string) => {
      setToasts(prev => prev.filter(t => t.id !== id));
  };

  const renderDateFilter = () => (
      <div className="w-full sm:w-auto">
          <DateRangePicker 
              startDate={dateRange.start} 
              endDate={dateRange.end} 
              onChange={(start, end) => setDateRange({ start, end })} 
          />
      </div>
  );

  const requestExport = (callback: () => void) => {
      setPendingExport(() => callback);
      setExportPassword('');
      setShowExportModal(true);
  };

  const confirmExport = () => {
      if (exportPassword === 'QAZ@654') {
          if (pendingExport) pendingExport();
          setShowExportModal(false);
          setExportPassword('');
          setPendingExport(null);
          addToast('SUCCESS', 'Export Authorized & Downloaded.');
      } else {
          addToast('ERROR', 'Incorrect Admin Password.');
      }
  };

  // ... (Calculation Logic) ...
  const recalculateAllData = (allInvoices: Invoice[]) => {
    const sorted = [...allInvoices].sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        if (a.createdAt && b.createdAt) {
            const timeComp = a.createdAt.localeCompare(b.createdAt);
            if (timeComp !== 0) return timeComp;
        }
        return a.id.localeCompare(b.id);
    });

    let currentInventory: InventoryBatch[] = [];
    const processedInvoices: Invoice[] = [];

    for (const inv of sorted) {
        if (inv.type === 'PURCHASE') {
            const newBatch: InventoryBatch = {
                id: inv.id,
                date: inv.date,
                originalQuantity: inv.quantityGrams,
                remainingQuantity: inv.quantityGrams,
                costPerGram: inv.ratePerGram
            };
            currentInventory.push(newBatch);
            processedInvoices.push({ ...inv, cogs: 0, profit: 0, fifoLog: [] });
        } else {
            let remainingToSell = inv.quantityGrams;
            let totalCOGS = 0;
            const consumptionLog: string[] = [];
            
            if (!inv.createdAt) {
                consumptionLog.push("⚠️ WARNING: No Timestamp. Sequence assumed by ID.");
            }

            for (const batch of currentInventory) {
                if (remainingToSell <= 0) break;
                if (batch.remainingQuantity > 0.0001) { 
                    const take = Math.min(batch.remainingQuantity, remainingToSell);
                    batch.remainingQuantity -= take;
                    remainingToSell -= take;
                    const costForChunk = take * batch.costPerGram;
                    totalCOGS += costForChunk;
                    consumptionLog.push(`${formatGrams(take)} from ${batch.date} @ ${formatCurrency(batch.costPerGram)}`);
                    if (batch.remainingQuantity < 0.0001) {
                         batch.remainingQuantity = 0;
                         batch.closedDate = inv.date;
                    }
                }
            }
            if (remainingToSell > 0.0001) {
                consumptionLog.push(`⚠️ STOCKOUT: ${formatGrams(remainingToSell)} sold without inventory!`);
            }
            const profit = (inv.taxableAmount || (inv.quantityGrams * inv.ratePerGram)) - totalCOGS;
            processedInvoices.push({ ...inv, cogs: totalCOGS, profit, fifoLog: consumptionLog });
        }
    }
    return { updatedInvoices: processedInvoices, updatedInventory: currentInventory };
  };

  const loadData = async () => {
        try {
            setIsSyncing(true);
            const cloudOrders = await fetchOrders();
            const localOrders = loadInvoices(); 
            
            if (cloudOrders === null) {
                setDbError(true);
                const { updatedInvoices, updatedInventory } = recalculateAllData(localOrders);
                setInvoices(updatedInvoices.reverse()); 
                setInventory(updatedInventory);
                return;
            }
            setDbError(false);
            const cloudIds = new Set(cloudOrders.map(o => o.id));
            const unsyncedLocalOrders = localOrders.filter(lo => !cloudIds.has(lo.id));
            let finalOrders = cloudOrders;
            if (cloudOrders.length === 0 && localOrders.length > 0) {
                finalOrders = localOrders;
            } else if (unsyncedLocalOrders.length > 0) {
                 finalOrders = [...cloudOrders, ...unsyncedLocalOrders];
            }
            const { updatedInvoices, updatedInventory } = recalculateAllData(finalOrders);
            setInvoices(updatedInvoices.reverse()); 
            setInventory(updatedInventory);
        } catch (e) {
            console.error(e);
            addToast('ERROR', 'Failed to load data.');
        } finally {
            setIsSyncing(false);
        }
  };

  useEffect(() => {
    if (!session) return;
    loadData();
  }, [session]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
        const localOrders = loadInvoices();
        const cloudOrders = await fetchOrders();
        if (cloudOrders === null) {
            setDbError(true);
            addToast('ERROR', 'Database error.');
            return;
        }
        const cloudIds = new Set(cloudOrders.map(o => o.id));
        const missingInCloud = localOrders.filter(l => !cloudIds.has(l.id));
        if (missingInCloud.length === 0) {
            addToast('SUCCESS', 'Everything is up to date!');
        } else {
            const success = await bulkInsertOrders(missingInCloud);
            if (success) {
                addToast('SUCCESS', `Successfully uploaded ${missingInCloud.length} records.`);
                await loadData();
            } else {
                addToast('ERROR', 'Upload failed.');
            }
        }
    } catch (e) {
        addToast('ERROR', 'Sync error occurred.');
    } finally {
        setIsSyncing(false);
    }
  };

  useEffect(() => {
      if(lockDate) localStorage.setItem('bullion_lock_date', lockDate);
      else localStorage.removeItem('bullion_lock_date');
  }, [lockDate]);

  const handleLogout = async () => {
      setIsWorkingMode(false);
      await supabase.auth.signOut();
  };

  // --- Logic for Views ---
  const filteredInvoices = useMemo(() => {
      const query = searchQuery.toLowerCase();
      return invoices.filter(inv => {
          const matchesDate = inv.date >= dateRange.start && inv.date <= dateRange.end;
          const matchesSearch = !query || inv.partyName.toLowerCase().includes(query);
          return matchesDate && matchesSearch;
      });
  }, [invoices, dateRange, searchQuery]);

  const filteredInventory = useMemo(() => {
      const query = searchQuery.toLowerCase();
      return inventory.filter(batch => {
          const matchesDate = batch.date >= dateRange.start && batch.date <= dateRange.end;
          if (!matchesDate) return false;
          if (!query) return true;
          const invoice = invoices.find(inv => inv.id === batch.id);
          return invoice ? invoice.partyName.toLowerCase().includes(query) : false;
      });
  }, [inventory, invoices, dateRange, searchQuery]);

  const searchFilteredInventory = useMemo(() => {
      const query = searchQuery.toLowerCase();
      if (!query) return inventory;
      return inventory.filter(batch => {
          const invoice = invoices.find(inv => inv.id === batch.id);
          return invoice ? invoice.partyName.toLowerCase().includes(query) : false;
      });
  }, [inventory, invoices, searchQuery]);

  const currentStock = useMemo(() => searchFilteredInventory.reduce((acc, batch) => acc + batch.remainingQuantity, 0), [searchFilteredInventory]);
  const fifoValue = useMemo(() => searchFilteredInventory.reduce((acc, batch) => acc + (batch.remainingQuantity * batch.costPerGram), 0), [searchFilteredInventory]);
  const agingStats: AgingStats = useMemo(() => calculateStockAging(searchFilteredInventory), [searchFilteredInventory]);

  const { customerData, totalProfit, profitTrendData } = useMemo(() => {
      const customerStats: Record<string, CustomerStat & { avgQtyPerTx?: number, avgSellingPrice?: number, behaviorPattern?: string }> = {};
      let totalRevenueExTax = 0;
      let totalProfitCalc = 0;

      filteredInvoices.forEach(inv => {
          if (!customerStats[inv.partyName]) {
              customerStats[inv.partyName] = { 
                  name: inv.partyName, totalGrams: 0, totalSpend: 0, profitContribution: 0, txCount: 0, avgProfitPerGram: 0
              };
          }
          customerStats[inv.partyName].txCount += 1;

          if (inv.type === 'SALE') {
              customerStats[inv.partyName].totalGrams += inv.quantityGrams;
              customerStats[inv.partyName].totalSpend += inv.taxableAmount; 
              customerStats[inv.partyName].profitContribution += (inv.profit || 0);
              totalRevenueExTax += (inv.quantityGrams * inv.ratePerGram);
              totalProfitCalc += (inv.profit || 0);
          }
      });

      const data = Object.values(customerStats)
        .filter(stat => stat.totalSpend > 0)
        .map(stat => {
            const margin = stat.totalSpend > 0 ? (stat.profitContribution / stat.totalSpend) * 100 : 0;
            const avgQty = stat.totalGrams / stat.txCount;
            const avgSell = stat.totalGrams > 0 ? stat.totalSpend / stat.totalGrams : 0;
            const avgProfit = stat.totalGrams > 0 ? stat.profitContribution / stat.totalGrams : 0;
            
            let pattern = "Regular";
            if(avgQty > 100) pattern = "Bulk Buyer";
            else if(stat.txCount > 5) pattern = "Frequent";
            
            if(margin < 0.5) pattern += " (Price Sensitive)";
            else if(margin > 2.0) pattern += " (High Margin)";

            return {
                ...stat,
                margin: margin,
                avgProfitPerGram: avgProfit,
                avgQtyPerTx: avgQty,
                avgSellingPrice: avgSell,
                behaviorPattern: pattern
            };
        })
        .sort((a,b) => b.totalGrams - a.totalGrams);

      const pTrend = [];
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          const sales = invoices.filter(inv => inv.type === 'SALE' && inv.date === dateStr); 
          const profit = sales.reduce((acc, inv) => acc + (inv.profit || 0), 0);
          const grams = sales.reduce((acc, inv) => acc + inv.quantityGrams, 0);
          pTrend.push({ 
             date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), 
             profit: profit,
             ppg: grams > 0 ? profit / grams : 0
          });
      }

      return {
          customerData: data,
          totalProfit: totalProfitCalc,
          profitTrendData: pTrend,
      };
  }, [filteredInvoices, dateRange, invoices]);

  const supplierData: SupplierStat[] = useMemo(() => calculateSupplierStats(filteredInvoices), [filteredInvoices]);
  const turnoverStats = useMemo(() => calculateTurnoverStats(invoices, dateRange.start, dateRange.end), [invoices, dateRange]);
  
  const alerts: RiskAlert[] = useMemo(() => {
    const list: RiskAlert[] = [];
    if (agingStats.buckets['30+'] > 0) {
      list.push({ id: 'old-stock', severity: 'HIGH', context: 'Inventory', message: `${formatGrams(agingStats.buckets['30+'])} of gold is older than 30 days.` });
    }
    const recentSales = invoices.filter(i => i.type === 'SALE').slice(0, 5);
    if (recentSales.length > 0) {
       const recentMargin = recentSales.reduce((acc, i) => acc + (i.profit || 0), 0) / recentSales.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
       if (recentMargin < 0.005) { 
         list.push({ id: 'low-margin', severity: 'MEDIUM', context: 'Profit', message: 'Recent sales margins are critically low (< 0.5%).' });
       }
    }
    return list;
  }, [agingStats, invoices]);

  // ... (Delete and Edit handlers) ...
  const initiateDelete = (id: string) => { setDeleteId(id); setDeletePassword(''); setShowDeleteModal(true); };
  const confirmDelete = async () => {
      if (deletePassword === 'QAZ@789') {
          if (deleteId) {
              const success = await deleteOrderFromSupabase(deleteId);
              if (success) { await loadData(); addToast('SUCCESS', 'Record deleted.'); } else { addToast('ERROR', 'Failed to delete.'); }
          }
          setShowDeleteModal(false); setDeleteId(null); setDeletePassword('');
      } else { addToast('ERROR', 'Incorrect Admin Password.'); }
  };
  const handleInitEditName = (id: string, currentName: string) => { setEditNameId(id); setNewPartyName(currentName); setEditNamePassword(''); setShowEditNameModal(true); };
  const confirmNameUpdate = async () => {
      if (editNamePassword === 'QAZ@456') {
          if (editNameId && newPartyName.trim()) {
              const success = await updateOrderPartyName(editNameId, newPartyName.trim());
              if (success) { await loadData(); addToast('SUCCESS', 'Party name updated.'); } else { addToast('ERROR', 'Failed to update.'); }
          }
          setShowEditNameModal(false); setEditNameId(null); setEditNamePassword(''); setNewPartyName('');
      } else { addToast('ERROR', 'Incorrect Admin Password.'); }
  };
  const handleAddInvoice = async (invoice: Invoice) => {
    const newInvoicesList = [invoice, ...invoices];
    const { updatedInvoices, updatedInventory } = recalculateAllData(newInvoicesList);
    setInvoices(updatedInvoices.reverse()); setInventory(updatedInventory);
    const success = await saveOrderToSupabase(invoice);
    if (success) addToast('SUCCESS', 'Transaction Saved.'); else addToast('ERROR', 'Cloud save failed.');
  };

  const handleRunAudit = () => {
      const report = performFullSystemAudit(invoices, currentStock, fifoValue);
      setAuditReport(report);
      addToast('SUCCESS', `Audit Completed. Score: ${report.healthScore}/100`);
  };

  // --- PDF GENERATION ---
  const generatePDF = (
      title: string, 
      head: string[][], 
      body: (string | number)[][], 
      summary?: string[], 
      orientation: 'portrait' | 'landscape' = 'portrait',
      customPeriod?: { start: string, end: string } | string
  ) => {
      const doc = new jsPDF({ orientation });
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const themeGold = [209, 151, 38]; // #d19726
      const themeSlate = [15, 23, 42]; // #0f172a

      // Determine period string
      let periodText = "";
      if (typeof customPeriod === 'string') {
          periodText = customPeriod;
      } else if (customPeriod) {
          const s = new Date(customPeriod.start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const e = new Date(customPeriod.end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          periodText = `${s} - ${e}`;
      } else {
          // Default to app state dateRange
          const s = new Date(dateRange.start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const e = new Date(dateRange.end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          periodText = `${s} - ${e}`;
      }

      // Sanitize body for Rupee symbol compatibility in PDF
      const safeBody = body.map(row => row.map(cell => 
          typeof cell === 'string' ? cell.replace(/₹/g, 'Rs. ') : cell
      ));
      
      const safeSummary = summary ? summary.map(s => s.replace(/₹/g, 'Rs. ')) : undefined;

      // Header Design
      const drawHeader = () => {
          // Gold Accent Top Bar
          doc.setFillColor(themeGold[0], themeGold[1], themeGold[2]);
          doc.rect(0, 0, pageWidth, 5, 'F');
          
          // Branding (Top Right)
          doc.setFont('courier', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(themeSlate[0], themeSlate[1], themeSlate[2]);
          doc.text("BullionKeep", pageWidth - 14, 20, { align: 'right' });
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.text("INTELLIGENCE LEDGER", pageWidth - 14, 24, { align: 'right' });
      };

      // Footer
      const drawFooter = (pageNumber: number) => {
          const footerY = pageHeight - 10;
          doc.setDrawColor(226, 232, 240); // Slate-200
          doc.setLineWidth(0.1);
          doc.line(14, footerY - 5, pageWidth - 14, footerY - 5);
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184); // Slate-400
          doc.text("Confidential Report - Generated by BullionKeep AI", 14, footerY);
          doc.text("Strategically Directed & Managed by Kunal", pageWidth / 2, footerY, { align: 'center' });
          doc.text(`Page ${pageNumber}`, pageWidth - 14, footerY, { align: 'right' });
      };

      drawHeader();

      // Title Section
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(themeSlate[0], themeSlate[1], themeSlate[2]);
      doc.text(title, 14, 25);
      
      // Period Subtitle
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(themeGold[0], themeGold[1], themeGold[2]);
      doc.text("REPORTING PERIOD", 14, 33);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(periodText, 50, 33);

      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 38);

      let startY = 48;

      // Summary Section
      if (safeSummary && safeSummary.length > 0) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(9);
          
          const lineHeight = 5;
          const padding = 6;
          const boxHeight = (safeSummary.length * lineHeight) + (padding * 2);
          
          // Background
          doc.setFillColor(250, 250, 250); 
          doc.setDrawColor(226, 232, 240); 
          doc.roundedRect(14, startY, pageWidth - 28, boxHeight, 2, 2, 'FD');
          
          // Accent Border
          doc.setDrawColor(themeGold[0], themeGold[1], themeGold[2]);
          doc.setLineWidth(1);
          doc.line(14, startY + 1, 14, startY + boxHeight - 1); 

          doc.setTextColor(51, 65, 85); // Slate-700
          safeSummary.forEach((line, i) => {
              doc.text(line, 18, startY + padding + 3 + (i * lineHeight));
          });

          startY += boxHeight + 10;
      }

      // Table
      autoTable(doc, {
          startY: startY,
          head: head,
          body: safeBody,
          theme: 'grid',
          styles: {
              font: 'helvetica',
              fontSize: 7, // Reduced font size to fit columns
              textColor: [51, 65, 85],
              cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
              lineColor: [226, 232, 240],
              lineWidth: 0.1,
              overflow: 'linebreak'
          },
          headStyles: {
              fillColor: [15, 23, 42], // Slate 950
              textColor: [255, 255, 255],
              fontStyle: 'bold',
              halign: 'left',
              valign: 'middle', // Corrects header alignment
          },
          bodyStyles: {
              valign: 'middle', // Ensures vertical centering in rows
          },
          alternateRowStyles: {
              fillColor: [248, 250, 252], // Slate 50
          },
          didParseCell: function(data) {
              const raw = data.cell.raw;
              if (typeof raw === 'string' && (raw.includes('Rs.') || raw.match(/^\d/))) {
                  data.cell.styles.halign = 'right';
              }
          },
          didDrawPage: (data) => {
              if (data.pageNumber > 1) {
                  drawHeader();
              }
              drawFooter(data.pageNumber);
          },
          margin: { top: 30, bottom: 20, left: 14, right: 14 }
      });

      doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  };

  const handleInventoryExport = (type: 'CSV' | 'PDF') => {
      const data = inventory.filter(inv => inv.date >= dateRange.start && inv.date <= dateRange.end).map(b => ({
          batchId: b.id, date: b.date, originalQty: b.originalQuantity, remainingQty: b.remainingQuantity, costPerGram: b.costPerGram, totalValue: b.remainingQuantity * b.costPerGram, status: b.remainingQuantity > 0 ? 'Active' : 'Closed'
      }));
      if (type === 'CSV') {
          const headers = ['Batch ID', 'Date', 'Original Qty (g)', 'Remaining Qty (g)', 'Cost (INR/g)', 'Total Value (INR)', 'Status'];
          const csv = [headers.join(','), ...data.map(r => [r.batchId, r.date, r.originalQty, r.remainingQty, r.costPerGram, r.totalValue, r.status].join(','))].join('\n');
          downloadCSV(csv, `inventory_report_${new Date().toISOString().split('T')[0]}.csv`);
          addToast('SUCCESS', 'Inventory CSV downloaded.');
      } else {
          // Landscape for Inventory to fit columns comfortably
          generatePDF('Inventory Report', [['Batch ID', 'Date', 'Original (g)', 'Remaining (g)', 'Cost/g', 'Value', 'Status']], data.map(r => [r.batchId, r.date, formatGrams(r.originalQty), formatGrams(r.remainingQty), formatCurrency(r.costPerGram), formatCurrency(r.totalValue), r.status]), undefined, 'landscape', dateRange);
      }
  };
  
  const handlePriceExport = (type: 'CSV' | 'PDF', purchases: Invoice[]) => {
       if (type === 'CSV') {
           const headers = ['Date', 'Supplier', 'Quantity (g)', 'Rate (INR/g)', 'Total (INR)'];
           const csv = [headers.join(','), ...purchases.map(p => [p.date, `"${p.partyName}"`, p.quantityGrams, p.ratePerGram, p.quantityGrams * p.ratePerGram].join(','))].join('\n');
           downloadCSV(csv, `price_analysis_purchases_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Price Data CSV downloaded.');
       } else {
           generatePDF('Price Analysis - Purchases', [['Date', 'Supplier', 'Qty (g)', 'Rate (INR/g)', 'Total (INR)']], purchases.map(p => [p.date, p.partyName, formatGrams(p.quantityGrams), formatCurrency(p.ratePerGram), formatCurrency(p.quantityGrams * p.ratePerGram)]), undefined, 'portrait', dateRange);
       }
  };

  const handleCustomerExport = (type: 'CSV' | 'PDF') => {
       if (type === 'CSV') {
           const headers = ['Customer', 'Frequency', 'Total Grams', 'Revenue (Ex GST)', 'Avg Price', 'Avg Profit/g', 'Pattern'];
           const csv = [headers.join(','), ...customerData.map(c => [`"${c.name}"`, c.txCount, c.totalGrams, c.totalSpend, c.avgSellingPrice, c.avgProfitPerGram, c.behaviorPattern].join(','))].join('\n');
           downloadCSV(csv, `customer_insights_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Customer Data CSV downloaded.');
       } else {
           // Landscape for Customer Insights
           generatePDF('Customer Intelligence Report', [['Customer', 'Freq', 'Total Grams', 'Revenue (Ex GST)', 'Avg Price', 'Profit/g', 'Pattern']], customerData.map(c => [c.name, c.txCount, formatGrams(c.totalGrams), formatCurrency(c.totalSpend), formatCurrency(c.avgSellingPrice || 0), formatCurrency(c.avgProfitPerGram || 0), c.behaviorPattern || '']), undefined, 'landscape', dateRange);
       }
  };

  const handleSupplierExport = (type: 'CSV' | 'PDF') => {
       if (type === 'CSV') {
           const headers = ['Supplier', 'Transactions', 'Total Volume (g)', 'Avg Rate', 'Min Rate', 'Max Rate', 'Volatility'];
           const csv = [headers.join(','), ...supplierData.map(s => [`"${s.name}"`, s.txCount, s.totalGramsPurchased, s.avgRate, s.minRate, s.maxRate, s.volatility].join(','))].join('\n');
           downloadCSV(csv, `supplier_insights_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Supplier Data CSV downloaded.');
       } else {
           // Landscape for Supplier Insights
           generatePDF('Supplier Insights Report', [['Supplier', 'Tx Count', 'Vol (g)', 'Avg Rate', 'Min', 'Max', 'Volatility']], supplierData.map(s => [s.name, s.txCount, formatGrams(s.totalGramsPurchased), formatCurrency(s.avgRate), formatCurrency(s.minRate), formatCurrency(s.maxRate), formatCurrency(s.volatility)]), undefined, 'landscape', dateRange);
       }
  };

  const handleLedgerExport = (type: 'CSV' | 'PDF', monthlyData: any[], totals: any) => {
      if (type === 'CSV') {
          const headers = ['Month', 'Turnover (Ex GST)', 'Profit', 'Margin %', 'Qty Sold'];
          const csv = [headers.join(','), ...monthlyData.map(m => [m.date.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}), m.turnover, m.profit, (m.turnover > 0 ? (m.profit/m.turnover)*100 : 0).toFixed(2), m.qty].join(','))].join('\n');
          downloadCSV(csv, `business_ledger_lifetime.csv`);
          addToast('SUCCESS', 'Ledger CSV downloaded.');
      } else {
          // If monthly data is empty, handle potential error
          let period = "Lifetime";
          if (monthlyData.length > 0) {
              const start = monthlyData[monthlyData.length - 1].date.toISOString();
              const end = monthlyData[0].date.toISOString();
              period = { start, end } as any;
          }
          generatePDF('Business Performance Ledger', [['Month', 'Turnover (Ex GST)', 'Profit', 'Margin %', 'Qty Sold']], monthlyData.map(m => [m.date.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}), formatCurrency(m.turnover), formatCurrency(m.profit), (m.turnover > 0 ? (m.profit/m.turnover)*100 : 0).toFixed(2) + '%', formatGrams(m.qty)]), [`Total Turnover (Ex GST): ${formatCurrency(totals.turnover)}`, `Total Profit: ${formatCurrency(totals.profit)}`, `Overall Margin: ${totals.margin.toFixed(2)}%`, `Total Gold Sold: ${formatGrams(totals.qty)}`], 'portrait', period);
      }
  };

  const handleInvoicesExport = (type: 'CSV' | 'PDF') => {
       const data = [...filteredInvoices].sort((a,b) => b.date.localeCompare(a.date));
       if (type === 'CSV') {
           const headers = ['Date', 'Type', 'Party', 'Qty (g)', 'Rate (INR/g)', 'My Cost (INR/g)', 'Taxable (Ex GST)', 'GST (INR)', 'Total (Inc GST)', 'My Total Cost (Ex GST)', 'Profit (Ex GST)'];
           const csv = [headers.join(','), ...data.map(i => {
                   const myCost = i.type === 'SALE' && i.cogs ? (i.cogs / i.quantityGrams) : 0;
                   const myTotalCost = i.type === 'SALE' ? (i.cogs || 0) : i.taxableAmount;
                   return [i.date, i.type, `"${i.partyName}"`, i.quantityGrams, i.ratePerGram, myCost > 0 ? myCost.toFixed(2) : '-', i.taxableAmount, i.gstAmount, i.totalAmount, myTotalCost, i.profit || 0].join(',')
               })].join('\n');
           downloadCSV(csv, `transactions_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Transactions CSV downloaded.');
       } else {
           // Use Landscape for the detailed Transaction Report (11 columns)
           generatePDF('Transaction Report', [['Date', 'Type', 'Party', 'Qty', 'Rate', 'My Cost', 'Taxable', 'GST', 'Total', 'Total Cost', 'Profit']], data.map(i => {
                 const myCost = i.type === 'SALE' && i.cogs ? (i.cogs / i.quantityGrams) : 0;
                 const myTotalCost = i.type === 'SALE' ? (i.cogs || 0) : i.taxableAmount;
                 return [i.date, i.type.substring(0,1), i.partyName, formatGrams(i.quantityGrams), formatCurrency(i.ratePerGram), myCost > 0 ? formatCurrency(myCost) : '-', formatCurrency(i.taxableAmount), formatCurrency(i.gstAmount), formatCurrency(i.totalAmount), formatCurrency(myTotalCost), i.profit ? formatCurrency(i.profit) : '-']
             }), undefined, 'landscape', dateRange);
       }
  };

  // --- SUB-VIEWS ---

  const DashboardView = () => {
       const qtySoldPeriod = filteredInvoices.filter(i => i.type === 'SALE').reduce((acc, i) => acc + i.quantityGrams, 0);
       const localCount = loadInvoices().length;
       const cloudCount = invoices.length;
       const hasMissing = localCount > cloudCount;

       return (
            <div className="space-y-6 animate-enter">
                <SectionHeader title="Dashboard" subtitle="Overview of your inventory and performance." action={renderDateFilter()}/>
                {dbError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-red-600 shadow-xl flex items-center gap-4 animate-pulse-slow">
                        <div className="p-3 bg-red-100 rounded-full text-red-600"><Database className="w-6 h-6"/></div>
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-red-700">Database Connection Issue</h3>
                            <p className="text-sm font-medium text-red-600/80 mt-1">We cannot fetch your cloud data. This usually happens if the <strong>SQL Setup</strong> hasn't been run yet.</p>
                        </div>
                    </div>
                )}
                {/* Cloud Sync Card */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 border border-slate-700/50">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-full ${hasMissing ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>{isSyncing ? <RefreshCw className="w-6 h-6 animate-spin"/> : <CloudCog className="w-6 h-6"/>}</div>
                        <div>
                            <h3 className="font-bold text-lg">Cloud Sync Status</h3>
                            <div className="flex gap-4 text-sm text-slate-400 mt-1">
                                <span className="flex items-center gap-1"><Server className="w-3 h-3"/> Cloud: {cloudCount}</span>
                                <span className="flex items-center gap-1"><FileText className="w-3 h-3"/> Local: {localCount}</span>
                            </div>
                        </div>
                    </div>
                    {hasMissing ? (
                         <div className="flex items-center gap-4">
                             <p className="text-sm font-medium text-amber-300">Unsynced records found on this device.</p>
                             <button onClick={handleManualSync} disabled={isSyncing} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-lg transition-colors flex items-center gap-2">{isSyncing ? 'Uploading...' : 'Sync Now'} <CloudUpload className="w-4 h-4"/></button>
                         </div>
                    ) : (
                        <div className="flex items-center gap-2 text-green-400 bg-green-500/10 px-4 py-2 rounded-lg border border-green-500/20"><CheckCircle className="w-4 h-4"/><span className="text-sm font-bold">System Synchronized</span></div>
                    )}
                </div>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatsCard title="Current Stock" value={formatGrams(currentStock)} subValue={`${inventory.filter(b=>b.remainingQuantity>0).length} active batches`} icon={Coins} delayIndex={0} isActive />
                    <StatsCard title="Inventory Value" value={formatCurrency(fifoValue)} subValue="FIFO Basis" icon={Briefcase} delayIndex={1} />
                    <StatsCard title="Total Profit" value={formatCurrency(totalProfit)} subValue="Realized (Period)" icon={TrendingUp} delayIndex={2} />
                    <StatsCard title="Avg. Aging" value={`${Math.round(agingStats.weightedAvgDays)} Days`} subValue="Stock Age" icon={Timer} delayIndex={3} />
                </div>
                {/* Charts Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                     <div className="lg:col-span-2 space-y-6">
                          <Card title="Business Health & Alerts" delay={4}>
                               {alerts.length === 0 ? (
                                   <div className="flex flex-col items-center justify-center h-40 text-slate-400"><CheckCircle className="w-8 h-8 mb-2 text-green-500" /><p>All systems healthy. No risk alerts.</p></div>
                               ) : (
                                   <div className="space-y-3">{alerts.map(alert => (<div key={alert.id} className={`flex items-start gap-4 p-4 rounded-xl border ${alert.severity === 'HIGH' ? 'bg-red-50 border-red-100 text-red-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}><AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" /><div><p className="font-bold text-sm uppercase tracking-wide mb-1">{alert.context}</p><p className="text-sm font-medium">{alert.message}</p></div></div>))}</div>
                               )}
                          </Card>
                          <Card title="Recent Activity" delay={5}>
                               <div className="space-y-3">{invoices.slice(0, 5).map(inv => (<div key={inv.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors border border-slate-50"><div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${inv.type === 'PURCHASE' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{inv.type === 'PURCHASE' ? <ArrowRightLeft className="w-4 h-4"/> : <Coins className="w-4 h-4"/>}</div><div><p className="font-bold text-slate-900 text-sm">{inv.partyName}</p><p className="text-xs text-slate-500">{new Date(inv.date).toLocaleDateString()}</p></div></div><div className="text-right"><p className="font-mono font-bold text-sm">{formatGrams(inv.quantityGrams)}</p><p className="text-xs text-slate-500">{formatCurrency(inv.totalAmount)}</p></div></div>))}</div>
                          </Card>
                     </div>
                     <div className="space-y-6">
                          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col items-center text-center justify-center min-h-[200px] relative overflow-hidden">
                               <div className="absolute inset-0 bg-gradient-to-br from-gold-500/10 to-transparent"></div>
                               <h3 className="relative z-10 text-3xl font-mono font-bold mb-1 text-gold-400">{formatGrams(qtySoldPeriod)}</h3>
                               <p className="relative z-10 text-slate-400 text-xs font-bold uppercase tracking-widest">Volume Sold (Period)</p>
                          </div>
                          <Card title="Stock Aging" delay={6}>
                               <div className="space-y-4">{Object.entries(agingStats.buckets).map(([range, qty]) => (<div key={range}><div className="flex justify-between text-xs mb-1"><span className="font-bold text-slate-500">{range} Days</span><span className="font-mono text-slate-700">{formatGrams(qty)}</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${range === '30+' ? 'bg-red-500' : 'bg-gold-500'}`} style={{ width: `${currentStock > 0 ? (qty / currentStock) * 100 : 0}%` }}></div></div></div>))}</div>
                          </Card>
                     </div>
                </div>
            </div>
       );
  };
  
  const CustomerInsightsView = () => {
    // ... existing code
    const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

    // Filter unique customers who have made purchases (SALES) in the current date range
    const activeCustomers = useMemo(() => {
        const stats: Record<string, { count: number, totalVol: number }> = {};
        filteredInvoices.filter(i => i.type === 'SALE').forEach(inv => {
            if(!stats[inv.partyName]) stats[inv.partyName] = { count: 0, totalVol: 0 };
            stats[inv.partyName].count += 1;
            stats[inv.partyName].totalVol += inv.quantityGrams;
        });
        return Object.entries(stats)
            .map(([name, val]) => ({ name, ...val }))
            .sort((a,b) => b.totalVol - a.totalVol);
    }, [filteredInvoices]);

    // Calculate aggregated stats for the selected customer
    const selectedCustomerStats = useMemo(() => {
        if (!selectedCustomer) return null;
        const txs = filteredInvoices.filter(i => i.type === 'SALE' && i.partyName === selectedCustomer);
        const totalVol = txs.reduce((sum, i) => sum + i.quantityGrams, 0);
        const totalRev = txs.reduce((sum, i) => sum + i.taxableAmount, 0);
        const totalProfit = txs.reduce((sum, i) => sum + (i.profit || 0), 0);
        const avgMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;
        
        return {
            totalVol,
            totalRev,
            totalProfit,
            avgMargin,
            txs: txs.sort((a,b) => b.date.localeCompare(a.date)) // Recent first
        };
    }, [selectedCustomer, filteredInvoices]);

    const handleSingleCustomerExport = (type: 'CSV' | 'PDF') => {
        if (!selectedCustomer || !selectedCustomerStats) return;
        
        const { txs, totalVol, totalRev, totalProfit, avgMargin } = selectedCustomerStats;
        const filename = `${selectedCustomer.replace(/\s+/g, '_')}_sales_history`;

        // Wrap the actual export logic in a closure for the security modal
        const executeExport = () => {
             if (type === 'CSV') {
                const headers = ['Date', 'Volume (g)', 'Rate (INR/g)', 'Sale Value (Ex GST)', 'Profit', 'Margin %'];
                const rows = txs.map(sale => {
                    const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                    return [
                        sale.date,
                        sale.quantityGrams,
                        sale.ratePerGram,
                        sale.taxableAmount,
                        sale.profit || 0,
                        margin.toFixed(2)
                    ].join(',');
                });
                const csvContent = [headers.join(','), ...rows].join('\n');
                downloadCSV(csvContent, `${filename}.csv`);
            } else {
                // PDF
                const head = [['Date', 'Volume (g)', 'Rate', 'Sale Value', 'Profit', 'Margin %']];
                const body = txs.map(sale => {
                    const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                    return [
                        sale.date,
                        formatGrams(sale.quantityGrams),
                        formatCurrency(sale.ratePerGram),
                        formatCurrency(sale.taxableAmount),
                        formatCurrency(sale.profit || 0),
                        `${margin.toFixed(2)}%`
                    ];
                });
                const summary = [
                    `Customer: ${selectedCustomer}`,
                    `Total Volume: ${formatGrams(totalVol)}`,
                    `Total Revenue: ${formatCurrency(totalRev)}`,
                    `Total Profit: ${formatCurrency(totalProfit)}`,
                    `Avg Margin: ${avgMargin.toFixed(2)}%`
                ];
                generatePDF(`Sales History: ${selectedCustomer}`, head, body, summary, 'portrait', dateRange);
            }
        };

        // Trigger the security modal
        requestExport(executeExport);
    };

    return (
        <div className="space-y-8 animate-enter">
            <SectionHeader title="Customer Intelligence" subtitle="Analyze purchasing patterns and profitability." action={<div className="flex gap-2 items-center"><ExportMenu onExport={(t) => requestExport(() => handleCustomerExport(t))} />{renderDateFilter()}</div>}/>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">{customerData.slice(0, 3).map((c, i) => (<div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-card flex flex-col gap-4 relative overflow-hidden group hover:shadow-lg transition-all"><div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-purple-500/10 to-transparent rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform"></div><div className="flex justify-between items-start z-10"><div><h3 className="font-bold text-lg text-slate-900 truncate max-w-[150px]">{c.name}</h3><p className="text-xs text-purple-600 font-bold bg-purple-50 px-2 py-1 rounded-md inline-block mt-1">{c.behaviorPattern}</p></div><div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Users className="w-5 h-5"/></div></div><div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4 z-10"><div><p className="text-[10px] uppercase text-slate-400 font-bold">Total Grams</p><p className="font-mono font-bold text-slate-700">{formatGrams(c.totalGrams)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold">Total Revenue</p><p className="font-mono font-bold text-slate-700">{formatCurrency(c.totalSpend)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold">Tx Count</p><p className="font-mono font-bold text-slate-700">{c.txCount}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold">Avg Price/g</p><p className="font-mono font-bold text-slate-700">{formatCurrency(c.avgSellingPrice || 0)}</p></div></div></div>))}</div>
            <Card title="Top 10 Customer Rankings (By Volume)">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm text-left">
                        <thead className="text-slate-500 bg-slate-50/50">
                            <tr>
                                <th className="px-4 py-3 text-center w-16">Rank</th>
                                <th className="px-4 py-3">Customer</th>
                                <th className="px-4 py-3 text-center">Frequency</th>
                                <th className="px-4 py-3 text-right">Volume (g)</th>
                                <th className="px-4 py-3 text-right">Revenue (Ex GST)</th>
                                <th className="px-4 py-3 text-right">Avg Price/g</th>
                                <th className="px-4 py-3 text-right">Profit Contribution</th>
                            </tr>
                        </thead>
                        <tbody>
                            {customerData.slice(0, 10).map((c, i) => (
                                <tr key={i} className="hover:bg-slate-50 border-b border-slate-50">
                                    <td className="px-4 py-3 text-center font-bold text-slate-400">
                                        {i < 3 ? (
                                            <span className={`flex items-center justify-center w-6 h-6 rounded-full mx-auto ${i === 0 ? 'bg-gold-100 text-gold-700' : i === 1 ? 'bg-slate-200 text-slate-700' : 'bg-orange-100 text-orange-800'}`}>
                                                {i + 1}
                                            </span>
                                        ) : `#${i + 1}`}
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="font-bold text-slate-800">{c.name}</p>
                                        <p className="text-xs text-slate-500">{c.behaviorPattern}</p>
                                    </td>
                                    <td className="px-4 py-3 text-center text-slate-500">{c.txCount}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{formatGrams(c.totalGrams)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(c.totalSpend)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-500">{formatCurrency(c.avgSellingPrice || 0)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatCurrency(c.profitContribution)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
            
            <Card title="Detailed Sales Ledger">
                {!selectedCustomer ? (
                    // Master View: List of Customers
                    <div className="space-y-4">
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600 flex items-center gap-2">
                             <Info className="w-4 h-4 text-blue-500"/> Select a customer to view their detailed transaction history and performance metrics.
                        </div>
                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="text-slate-500 bg-slate-50/50">
                                    <tr>
                                        <th className="px-4 py-3">Customer Name</th>
                                        <th className="px-4 py-3 text-center">Transactions</th>
                                        <th className="px-4 py-3 text-right">Total Volume (Period)</th>
                                        <th className="px-4 py-3 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeCustomers.length === 0 ? (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 italic">No active customers in this period.</td></tr>
                                    ) : (
                                        activeCustomers.map((c, i) => (
                                            <tr key={i} className="hover:bg-slate-50 border-b border-slate-50 group cursor-pointer" onClick={() => setSelectedCustomer(c.name)}>
                                                <td className="px-4 py-3 font-medium text-slate-900 group-hover:text-gold-600 transition-colors">{c.name}</td>
                                                <td className="px-4 py-3 text-center text-slate-500">{c.count}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">{formatGrams(c.totalVol)}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <button className="p-2 bg-slate-100 rounded-lg text-slate-400 group-hover:bg-gold-500 group-hover:text-white transition-all">
                                                        <ChevronRight className="w-4 h-4"/>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    // Detail View: Specific Customer History
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={() => setSelectedCustomer(null)}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4"/> Back to List
                                </button>
                                <h3 className="text-xl font-bold text-slate-800">{selectedCustomer}</h3>
                            </div>
                            <ExportMenu onExport={handleSingleCustomerExport} />
                        </div>

                        {/* Summary Header for Selected Customer */}
                        {selectedCustomerStats && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl text-white shadow-lg">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Stock Bought</p>
                                    <p className="text-2xl font-mono font-bold text-gold-400">{formatGrams(selectedCustomerStats.totalVol)}</p>
                                    <p className="text-xs text-slate-500">In selected period</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Revenue</p>
                                    <p className="text-2xl font-mono font-bold">{formatCurrency(selectedCustomerStats.totalRev)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Profit</p>
                                    <p className="text-2xl font-mono font-bold text-green-400">{formatCurrency(selectedCustomerStats.totalProfit)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Margin</p>
                                    <p className={`text-2xl font-mono font-bold ${selectedCustomerStats.avgMargin < 1 ? 'text-red-400' : 'text-green-400'}`}>
                                        {selectedCustomerStats.avgMargin.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="text-slate-500 bg-slate-50/50">
                                    <tr>
                                        <th className="px-4 py-3">Date</th>
                                        <th className="px-4 py-3 text-right">Volume (g)</th>
                                        <th className="px-4 py-3 text-right">Rate (INR/g)</th>
                                        <th className="px-4 py-3 text-right">Sale Value (Ex GST)</th>
                                        <th className="px-4 py-3 text-right">Profit</th>
                                        <th className="px-4 py-3 text-right">Margin %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedCustomerStats?.txs.map((sale) => {
                                        const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                                        return (
                                            <tr key={sale.id} className="hover:bg-slate-50 border-b border-slate-50">
                                                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{sale.date}</td>
                                                <td className="px-4 py-3 text-right font-mono">{formatGrams(sale.quantityGrams)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-500">{formatCurrency(sale.ratePerGram)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(sale.taxableAmount)}</td>
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${(sale.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {formatCurrency(sale.profit || 0)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${margin >= 1 ? 'bg-green-100 text-green-700' : margin >= 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                                        {margin.toFixed(2)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
  }

  const InvoicesView = () => (
      <div className="flex flex-col lg:flex-row gap-6 relative items-start h-full">
          <div className="w-full lg:w-[380px] xl:w-[420px] flex-shrink-0 lg:sticky lg:top-0 transition-all -mt-6">
              <InvoiceForm 
                onAdd={handleAddInvoice} 
                currentStock={currentStock} 
                lockDate={lockDate} 
                invoices={invoices}
                isWorkingMode={isWorkingMode} 
                setIsWorkingMode={setIsWorkingMode}
              />
          </div>
          <div className="flex-1 w-full min-w-0">
              <Card title="Recent Transactions" className="min-h-[600px] h-full flex flex-col" delay={200}
                 action={
                     <div className="flex gap-2 items-center">
                        <ExportMenu onExport={(t) => requestExport(() => handleInvoicesExport(t))} />
                        {renderDateFilter()}
                     </div>
                 }
              >
                  {/* ... Table ... */}
                  <div className="overflow-auto flex-1 -mx-6 px-6 relative custom-scrollbar">
                      <table className="w-full text-sm text-left border-separate border-spacing-y-2 min-w-[1000px]">
                          <thead className="text-slate-400 sticky top-0 bg-white/95 backdrop-blur z-10">
                              <tr>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50">Date</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50">Type</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50">Party</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">Qty</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">Rate/g</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">My Cost/g</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">Taxable (Ex GST)</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">GST</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">Total (Inc)</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">My Total Cost (Ex GST)</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-right">Profit</th>
                                  <th className="px-4 py-3 font-semibold uppercase text-xs tracking-wider border-b border-slate-50 text-center">Action</th>
                              </tr>
                          </thead>
                          <tbody>
                              {filteredInvoices.length === 0 ? (
                                  <tr><td colSpan={12} className="px-4 py-20 text-center text-slate-400 italic">No transactions recorded in this period.</td></tr>
                              ) : (
                                  filteredInvoices.sort((a,b) => b.date.localeCompare(a.date)).map((inv, i) => {
                                      const myCostPerGram = inv.type === 'SALE' && inv.cogs ? inv.cogs / inv.quantityGrams : null;
                                      return (
                                      <tr key={inv.id} className="group hover:scale-[1.01] transition-transform duration-200">
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-l border-transparent group-hover:border-slate-100 text-slate-500 font-mono text-xs rounded-l-xl">{inv.date}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100">
                                              <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border ${inv.type === 'PURCHASE' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-green-50 text-green-600 border-green-100'}`}>{inv.type === 'PURCHASE' ? 'In' : 'Out'}</span>
                                          </td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-medium text-slate-900 truncate max-w-[150px]">
                                              <div className="flex items-center justify-between gap-2 group/edit">
                                                  <span className="truncate">{inv.partyName}</span>
                                                  <button 
                                                    onClick={() => handleInitEditName(inv.id, inv.partyName)}
                                                    className="opacity-0 group-hover/edit:opacity-100 p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all"
                                                    title="Edit Name"
                                                  >
                                                      <Edit2 className="w-3 h-3"/>
                                                  </button>
                                              </div>
                                          </td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono text-slate-600 text-right">{formatGrams(inv.quantityGrams)}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono text-slate-500 text-right">{formatCurrency(inv.ratePerGram).replace('.00','')}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono text-slate-500 text-right">
                                              {myCostPerGram ? formatCurrency(myCostPerGram).replace('.00','') : '-'}
                                          </td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono font-medium text-slate-900 text-right">{formatCurrency(inv.taxableAmount)}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono text-slate-500 text-right">{formatCurrency(inv.gstAmount)}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono text-slate-400 text-right">{formatCurrency(inv.totalAmount)}</td>
                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono font-medium text-slate-700 text-right">
                                              {formatCurrency(inv.type === 'SALE' ? (inv.cogs || 0) : inv.taxableAmount)}
                                          </td>
                                          
                                          {/* PROFIT CELL WITH AUDIT TOOLTIP */}
                                          <td className={`px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-transparent group-hover:border-slate-100 font-mono font-bold text-right relative group/tooltip ${(inv.profit || 0) > 0 ? 'text-green-600' : (inv.profit || 0) < 0 ? 'text-red-600' : 'text-slate-300'}`}>
                                              {inv.type === 'SALE' ? (
                                                  <>
                                                      {formatCurrency(inv.profit || 0)}
                                                      {inv.fifoLog && inv.fifoLog.length > 0 && (
                                                          <div className="absolute right-0 bottom-full mb-2 w-64 bg-slate-900 text-white text-[10px] p-3 rounded-xl shadow-xl z-20 hidden group-hover/tooltip:block pointer-events-none">
                                                              <p className="font-bold text-gold-400 mb-1 border-b border-slate-700 pb-1 uppercase tracking-wide">FIFO Consumption Log</p>
                                                              <ul className="space-y-1 opacity-90 font-mono">
                                                                  {inv.fifoLog.map((log, idx) => (
                                                                      <li key={idx}>• {log}</li>
                                                                  ))}
                                                              </ul>
                                                          </div>
                                                      )}
                                                  </>
                                              ) : '-'}
                                          </td>

                                          <td className="px-4 py-3 bg-slate-50/50 group-hover:bg-white border-y border-r border-transparent group-hover:border-slate-100 rounded-r-xl text-center">
                                              <button onClick={() => initiateDelete(inv.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                  <Trash2 className="w-4 h-4"/>
                                              </button>
                                          </td>
                                      </tr>
                                  )})
                              )}
                          </tbody>
                      </table>
                  </div>
              </Card>
          </div>
      </div>
  );

  const AnalyticsView = () => {
      const realizedProfit = totalProfit; 
      const rate = parseFloat(marketRate);
      const hasRate = !isNaN(rate) && rate > 0;
      // Fixed arithmetic type error by forcing Number conversion
      const unrealizedProfit = hasRate ? (Number(currentStock) * Number(rate)) - Number(fifoValue) : 0;
      
      return (
      <div className="space-y-8 animate-enter">
        <SectionHeader title="Analytics & Reports" subtitle="Deep dive into your business performance." action={<div className="flex gap-2 items-center"><ExportMenu onExport={(t) => requestExport(() => addToast('SUCCESS', 'For detailed exports, use specific sections or Generate PDF below.'))} />{renderDateFilter()}</div>}/>
        
        {/* Top Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Inventory Turnover - Dark Theme */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl relative overflow-hidden shadow-xl shadow-slate-900/20 hover:-translate-y-1 transition-all duration-300">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/10 rounded-full blur-3xl -mr-10 -mt-10 animate-pulse-slow"></div>
                <div className="relative z-10 flex justify-between items-start">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Inventory Turnover</p>
                        <h3 className="text-3xl font-mono font-bold tracking-tight mb-1">{turnoverStats.turnoverRatio.toFixed(2)}x</h3>
                        <div className="flex items-center gap-1.5 mt-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                            <p className="text-[10px] font-bold text-slate-400">Ratio (COGS / Avg Inv)</p>
                        </div>
                    </div>
                    <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/5">
                        <Activity className="w-5 h-5 text-gold-400" />
                    </div>
                </div>
            </div>

            {/* Avg Days to Sell - White Theme */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-all duration-300 hover:-translate-y-1">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Avg Days to Sell</p>
                        <h3 className="text-3xl font-mono font-bold text-slate-900 tracking-tight mb-1">{Math.round(turnoverStats.avgDaysToSell)} Days</h3>
                        <p className="text-xs text-slate-500 font-medium mt-1">Velocity</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl text-slate-400">
                        <Timer className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Realized Profit - White Theme */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-all duration-300 hover:-translate-y-1">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Realized Profit</p>
                        <h3 className="text-3xl font-mono font-bold text-slate-900 tracking-tight mb-1">{formatCurrency(realizedProfit)}</h3>
                        <p className="text-xs text-slate-500 font-medium mt-1">From Sales</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl text-slate-400">
                        <Wallet className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Unrealized Profit - Dark Theme with Input */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl relative overflow-hidden shadow-xl shadow-slate-900/20 hover:-translate-y-1 transition-all duration-300">
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Unrealized Profit (Est)</p>
                        <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                             <TrendingUp className="w-3 h-3 text-green-400" />
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-slate-500 text-sm font-medium">@</span>
                        <input 
                            type="number" 
                            placeholder="Mkt Rate..." 
                            value={marketRate} 
                            onChange={(e) => setMarketRate(e.target.value)} 
                            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm text-white focus:border-gold-500 outline-none w-32 placeholder:text-slate-600 transition-colors"
                        />
                    </div>
                    
                    <h3 className={`text-2xl font-mono font-bold mt-2 ${hasRate && unrealizedProfit >= 0 ? 'text-green-400' : hasRate ? 'text-red-400' : 'text-slate-600'}`}>
                        {hasRate ? formatCurrency(unrealizedProfit) : '---'}
                    </h3>
                    
                    {/* Visual Dots */}
                    <div className="flex gap-1 mt-4">
                        <div className="w-4 h-1 rounded-full bg-green-500/50"></div>
                        <div className="w-4 h-1 rounded-full bg-green-500/30"></div>
                        <div className="w-4 h-1 rounded-full bg-green-500/10"></div>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Reports Generation Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div onClick={() => requestExport(() => handleCustomerExport('PDF'))} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5 group">
                <div className="p-4 rounded-xl bg-purple-50 text-purple-600 group-hover:scale-110 transition-transform">
                    <Users className="w-6 h-6"/>
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 text-lg group-hover:text-purple-700 transition-colors">Customer Report</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-1">Generate PDF</p>
                </div>
                <Download className="w-5 h-5 text-slate-300 ml-auto opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
            </div>

            <div onClick={() => requestExport(() => handleSupplierExport('PDF'))} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5 group">
                <div className="p-4 rounded-xl bg-blue-50 text-blue-600 group-hover:scale-110 transition-transform">
                    <Factory className="w-6 h-6"/>
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 text-lg group-hover:text-blue-700 transition-colors">Supplier Report</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-1">Generate PDF</p>
                </div>
                <Download className="w-5 h-5 text-slate-300 ml-auto opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
            </div>

            <div onClick={() => {
                 requestExport(() => generatePDF('Full Business Audit', 
                    [['Metric', 'Value']], 
                    [
                        ['Total Profit', formatCurrency(totalProfit)],
                        ['Current Stock', formatGrams(currentStock)],
                        ['Stock Value', formatCurrency(fifoValue)],
                        ['Turnover Ratio', turnoverStats.turnoverRatio.toFixed(2)],
                    ],
                    ['Confidential Audit Report', `Generated on ${new Date().toLocaleDateString()}`],
                    'portrait',
                    dateRange
                 ));
            }} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5 group">
                <div className="p-4 rounded-xl bg-gold-50 text-gold-600 group-hover:scale-110 transition-transform">
                    <FileText className="w-6 h-6"/>
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 text-lg group-hover:text-gold-700 transition-colors">Full Audit</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-1">Generate PDF</p>
                </div>
                <Download className="w-5 h-5 text-slate-300 ml-auto opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
            </div>
        </div>
      
        {/* Charts Row */}
        <div className="w-full">
            <Card title="Profit Trend" className="min-h-[400px]">
                <div className="h-[350px] w-full">
                    <ResponsiveContainer>
                        <AreaChart data={profitTrendData} margin={CHART_MARGIN}>
                            <defs>
                                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                            <XAxis 
                                dataKey="date" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{fill: '#94a3b8', fontSize: 11}} 
                                dy={10}
                            />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{fill: '#94a3b8', fontSize: 11}} 
                                tickFormatter={(v) => `${v/1000}k`} 
                            />
                            <Tooltip 
                                contentStyle={TOOLTIP_CONTENT_STYLE} 
                                formatter={(value: number) => [formatCurrency(value), 'Net Profit']}
                                cursor={{stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4'}}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="profit" 
                                stroke="#10b981" 
                                strokeWidth={3} 
                                fillOpacity={1} 
                                fill="url(#colorProfit)" 
                                activeDot={{r: 6, strokeWidth: 0, fill: '#10b981'}}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </Card>
        </div>
      </div>
      );
  }

  const BusinessLedgerView = () => {
      // Calculate monthly data
      const monthlyData = useMemo(() => {
          const stats: Record<string, { turnover: number, profit: number, qty: number }> = {};
          invoices.filter(i => i.type === 'SALE').forEach(inv => {
              const d = new Date(inv.date);
              const key = `${d.getFullYear()}-${d.getMonth()}`; // YYYY-M
              if (!stats[key]) stats[key] = { turnover: 0, profit: 0, qty: 0 };
              stats[key].turnover += inv.taxableAmount;
              stats[key].profit += (inv.profit || 0);
              stats[key].qty += inv.quantityGrams;
          });
          return Object.entries(stats).map(([key, val]) => {
              const [y, m] = key.split('-');
              return {
                  date: new Date(parseInt(y), parseInt(m), 1),
                  ...val
              };
          }).sort((a,b) => b.date.getTime() - a.date.getTime());
      }, [invoices]);

      const totals = monthlyData.reduce((acc, curr) => ({
          turnover: acc.turnover + curr.turnover,
          profit: acc.profit + curr.profit,
          qty: acc.qty + curr.qty
      }), { turnover: 0, profit: 0, qty: 0 });
      const overallMargin = totals.turnover > 0 ? (totals.profit / totals.turnover) * 100 : 0;

      return (
          <div className="space-y-6 animate-enter">
              <SectionHeader title="Business Ledger" subtitle="Monthly financial performance." action={<ExportMenu onExport={(t) => requestExport(() => handleLedgerExport(t, monthlyData, {...totals, margin: overallMargin}))} />} />
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg">
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Total Turnover</p>
                      <p className="text-2xl font-mono font-bold">{formatCurrency(totals.turnover)}</p>
                  </div>
                  <div className="bg-white text-slate-900 p-5 rounded-xl border border-slate-100 shadow-sm">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Total Profit</p>
                      <p className="text-2xl font-mono font-bold text-green-600">{formatCurrency(totals.profit)}</p>
                  </div>
                  <div className="bg-white text-slate-900 p-5 rounded-xl border border-slate-100 shadow-sm">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Overall Margin</p>
                      <p className="text-2xl font-mono font-bold">{overallMargin.toFixed(2)}%</p>
                  </div>
                  <div className="bg-white text-slate-900 p-5 rounded-xl border border-slate-100 shadow-sm">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Gold Sold</p>
                      <p className="text-2xl font-mono font-bold">{formatGrams(totals.qty)}</p>
                  </div>
              </div>

              <Card title="Monthly Breakdown">
                  <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-sm text-left">
                          <thead className="text-slate-500 bg-slate-50/50">
                              <tr>
                                  <th className="px-4 py-3">Month</th>
                                  <th className="px-4 py-3 text-right">Turnover (Ex GST)</th>
                                  <th className="px-4 py-3 text-right">Profit</th>
                                  <th className="px-4 py-3 text-right">Margin %</th>
                                  <th className="px-4 py-3 text-right">Qty Sold</th>
                              </tr>
                          </thead>
                          <tbody>
                              {monthlyData.length === 0 ? (
                                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">No sales data recorded yet.</td></tr>
                              ) : (
                                  monthlyData.map((m, i) => (
                                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                          <td className="px-4 py-3 font-bold text-slate-700">{m.date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td>
                                          <td className="px-4 py-3 text-right font-mono">{formatCurrency(m.turnover)}</td>
                                          <td className="px-4 py-3 text-right font-mono text-green-600 font-bold">{formatCurrency(m.profit)}</td>
                                          <td className="px-4 py-3 text-right font-mono text-slate-600">{(m.turnover > 0 ? (m.profit / m.turnover) * 100 : 0).toFixed(2)}%</td>
                                          <td className="px-4 py-3 text-right font-mono text-slate-500">{formatGrams(m.qty)}</td>
                                      </tr>
                                  ))
                              )}
                          </tbody>
                      </table>
                  </div>
              </Card>
          </div>
      );
  };

  const SupplierInsightsView = () => {
    const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

    // Filter transactions for the selected supplier
    const selectedSupplierStats = useMemo(() => {
        if (!selectedSupplier) return null;
        // Filter only purchases for supplier ledger
        const txs = filteredInvoices.filter(i => i.type === 'PURCHASE' && i.partyName === selectedSupplier).sort((a,b) => b.date.localeCompare(a.date));
        
        const totalVol = txs.reduce((sum, i) => sum + i.quantityGrams, 0);
        const totalCost = txs.reduce((sum, i) => sum + (i.quantityGrams * i.ratePerGram), 0);
        const avgRate = totalVol > 0 ? totalCost / totalVol : 0;
        
        return { txs, totalVol, totalCost, avgRate };
    }, [selectedSupplier, filteredInvoices]);

    const handleSingleSupplierExport = (type: 'CSV' | 'PDF') => {
        if (!selectedSupplier || !selectedSupplierStats) return;
        const { txs, totalVol, totalCost, avgRate } = selectedSupplierStats;
        const filename = `${selectedSupplier.replace(/\s+/g, '_')}_ledger`;

        const executeExport = () => {
            if (type === 'CSV') {
                const headers = ['Date', 'Volume (g)', 'Rate (INR/g)', 'Total Cost (Ex GST)'];
                const rows = txs.map(tx => [tx.date, tx.quantityGrams, tx.ratePerGram, tx.quantityGrams * tx.ratePerGram].join(','));
                const csvContent = [headers.join(','), ...rows].join('\n');
                downloadCSV(csvContent, `${filename}.csv`);
            } else {
                 const head = [['Date', 'Volume (g)', 'Rate', 'Total Cost']];
                 const body = txs.map(tx => [tx.date, formatGrams(tx.quantityGrams), formatCurrency(tx.ratePerGram), formatCurrency(tx.quantityGrams * tx.ratePerGram)]);
                 const summary = [
                     `Supplier: ${selectedSupplier}`,
                     `Total Volume Purchased: ${formatGrams(totalVol)}`,
                     `Total Expenditure: ${formatCurrency(totalCost)}`,
                     `Average Buying Rate: ${formatCurrency(avgRate)}`
                 ];
                 generatePDF(`Supplier Ledger: ${selectedSupplier}`, head, body, summary, 'portrait', dateRange);
            }
        };
        requestExport(executeExport);
    };

    return (
        <div className="space-y-8 animate-enter">
            <SectionHeader title="Supplier Insights" subtitle="Track supplier performance and rate volatility." action={<div className="flex gap-2 items-center"><ExportMenu onExport={(t) => requestExport(() => handleSupplierExport(t))} />{renderDateFilter()}</div>}/>
            
            {/* Top Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {supplierData.slice(0, 3).map((s, i) => {
                  const isVolatile = s.volatility > 100;
                  return (
                      <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                          <div className="flex justify-between items-start mb-6">
                              <div>
                                  <h3 className="font-bold text-lg text-slate-900 uppercase tracking-tight truncate max-w-[150px]">{s.name}</h3>
                                  <span className={`inline-block mt-2 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${isVolatile ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                                      {isVolatile ? 'High Volatility' : 'Stable'}
                                  </span>
                              </div>
                              <div className="p-2.5 bg-slate-50 text-slate-400 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                  <LineChartIcon className="w-5 h-5"/>
                              </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                              <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Bought</p>
                                  <p className="text-xl font-mono font-bold text-slate-900 tracking-tight">{formatGrams(s.totalGramsPurchased)}</p>
                              </div>
                              <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Rate</p>
                                  <p className="text-xl font-mono font-bold text-slate-900 tracking-tight">{formatCurrency(s.avgRate)}</p>
                              </div>
                              <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tx Count</p>
                                  <p className="text-xl font-mono font-bold text-slate-900 tracking-tight">{s.txCount}</p>
                              </div>
                              <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Volatility</p>
                                  <p className="text-xl font-mono font-bold text-slate-900 tracking-tight">{formatCurrency(s.volatility)}</p>
                              </div>
                          </div>
                      </div>
                  );
              })}
            </div>

            <Card title={selectedSupplier ? `Ledger: ${selectedSupplier}` : "Supplier Performance Summary"}>
                {!selectedSupplier ? (
                    // Master View: List of Suppliers
                    <div className="space-y-4">
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600 flex items-center gap-2">
                             <Info className="w-4 h-4 text-blue-500"/> Click on any row to view detailed transaction ledger for that supplier.
                        </div>
                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50/50 text-slate-500 font-semibold border-b border-slate-50">
                                    <tr>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold">Supplier</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-center">Tx Count</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Volume (g)</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Avg Rate</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Volatility</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {supplierData.length === 0 ? (
                                        <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No supplier data available for the selected period.</td></tr>
                                    ) : (
                                        supplierData.map((s, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => setSelectedSupplier(s.name)}>
                                                <td className="px-6 py-4 font-bold text-slate-800 uppercase text-xs tracking-wide group-hover:text-blue-600 transition-colors">{s.name}</td>
                                                <td className="px-6 py-4 text-center text-slate-500 font-medium">{s.txCount}</td>
                                                <td className="px-6 py-4 text-right font-mono text-slate-700 font-medium">{formatGrams(s.totalGramsPurchased)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-blue-600 font-bold">{formatCurrency(s.avgRate)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-slate-900 font-bold">{formatCurrency(s.volatility)}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <button className="p-2 bg-slate-100 rounded-lg text-slate-400 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                                        <ChevronRight className="w-4 h-4"/>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    // Detail View: Specific Supplier Ledger
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={() => setSelectedSupplier(null)}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4"/> Back to List
                                </button>
                                <h3 className="text-xl font-bold text-slate-800 uppercase tracking-tight">{selectedSupplier}</h3>
                            </div>
                            <ExportMenu onExport={handleSingleSupplierExport} />
                        </div>

                        {/* Summary Header for Selected Supplier */}
                        {selectedSupplierStats && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl text-white shadow-lg">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Volume Purchased</p>
                                    <p className="text-2xl font-mono font-bold text-blue-400">{formatGrams(selectedSupplierStats.totalVol)}</p>
                                    <p className="text-xs text-slate-500">In selected period</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Expenditure</p>
                                    <p className="text-2xl font-mono font-bold">{formatCurrency(selectedSupplierStats.totalCost)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Average Buying Rate</p>
                                    <p className="text-2xl font-mono font-bold text-gold-400">{formatCurrency(selectedSupplierStats.avgRate)}</p>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50/50 text-slate-500 font-semibold border-b border-slate-50">
                                    <tr>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold">Date</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Volume (g)</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Rate</th>
                                        <th className="px-6 py-4 uppercase text-[10px] tracking-wider font-bold text-right">Total Cost</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {selectedSupplierStats?.txs.length === 0 ? (
                                        <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">No purchase history found for this period.</td></tr>
                                    ) : (
                                        selectedSupplierStats?.txs.map((tx) => (
                                            <tr key={tx.id} className="hover:bg-slate-50 border-b border-slate-50">
                                                <td className="px-6 py-4 font-mono text-slate-600 text-xs">{tx.date}</td>
                                                <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">{formatGrams(tx.quantityGrams)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-slate-500">{formatCurrency(tx.ratePerGram)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-slate-700">{formatCurrency(tx.quantityGrams * tx.ratePerGram)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
  };

  const PriceAnalysisView = () => {
      const purchases = useMemo(() => filteredInvoices.filter(i => i.type === 'PURCHASE').sort((a,b) => a.date.localeCompare(b.date)), [filteredInvoices]);
      
      return (
          <div className="space-y-6 animate-enter">
              <SectionHeader title="Price Analysis" subtitle="Track gold rate fluctuations." action={<div className="flex gap-2 items-center"><ExportMenu onExport={(t) => requestExport(() => handlePriceExport(t, purchases))} />{renderDateFilter()}</div>} />
              <Card title="Purchase Rate Trend" className="min-h-[400px]">
                 <div className="h-[350px] w-full">
                    <ResponsiveContainer>
                        <AreaChart data={purchases} margin={CHART_MARGIN}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} dy={10} />
                            <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} />
                            <Tooltip contentStyle={{backgroundColor: '#fff', borderRadius: '12px'}} formatter={(val: number) => formatCurrency(val)} />
                            <Area type="monotone" dataKey="ratePerGram" stroke="#d97706" strokeWidth={2} fill="#fcd34d" fillOpacity={0.2} />
                        </AreaChart>
                    </ResponsiveContainer>
                 </div>
              </Card>
          </div>
      );
  };

  return (
    <>
      {!session ? (
        <Auth />
      ) : (
        <Layout 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
          searchQuery={searchQuery}
          onSearch={setSearchQuery}
          onLogout={handleLogout}
        >
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'invoices' && <InvoicesView />}
          {activeTab === 'inventory' && (
              <div className="animate-slide-up">
                  <SectionHeader 
                      title="Inventory Management" 
                      action={
                          <div className="flex gap-2 items-center">
                              <ExportMenu onExport={(t) => requestExport(() => handleInventoryExport(t))} />
                              {renderDateFilter()}
                          </div>
                      }
                  />
                  <InventoryTable batches={filteredInventory} invoices={invoices} />
              </div>
          )}
          {activeTab === 'analytics' && <AnalyticsView />}
          {activeTab === 'customer-insights' && <CustomerInsightsView />}
          {activeTab === 'supplier-insights' && <SupplierInsightsView />}
          {activeTab === 'price-analysis' && <PriceAnalysisView />}
          {activeTab === 'business-ledger' && <BusinessLedgerView />}
        </Layout>
      )}

      <Toast toasts={toasts} removeToast={removeToast} />
      
      {/* ... (Modals remain unchanged) ... */}
      {showDeleteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-3xl p-8 w-full max-w-[360px] shadow-2xl border border-slate-100 animate-slide-up transform transition-all">
                  <div className="mx-auto w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mb-5 text-red-500 shadow-inner">
                      <Trash2 className="w-7 h-7" />
                  </div>
                  
                  <div className="text-center mb-6">
                      <h3 className="font-bold text-xl text-slate-900 mb-2">Confirm Deletion</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">Management password required.</p>
                  </div>

                  <input 
                      type="password" 
                      placeholder="Password" 
                      value={deletePassword} 
                      onChange={(e) => setDeletePassword(e.target.value)} 
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-center font-medium focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all shadow-sm"
                      autoFocus
                  />
                  
                  <div className="flex items-center gap-3 mt-8">
                      <button 
                          onClick={() => { setShowDeleteModal(false); setDeletePassword(''); }} 
                          className="flex-1 py-3 text-slate-500 font-bold hover:text-slate-800 transition-colors text-sm"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={confirmDelete} 
                          className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 text-sm active:scale-95"
                      >
                          Delete
                      </button>
                  </div>
              </div>
          </div>
      )}

      {showEditNameModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
               <div className="bg-white rounded-3xl p-8 w-full max-w-[360px] shadow-2xl border border-slate-100 animate-slide-up transform transition-all">
                  <div className="mx-auto w-14 h-14 bg-gold-50 rounded-full flex items-center justify-center mb-5 text-gold-600 shadow-inner">
                      <Edit2 className="w-7 h-7" />
                  </div>
                  
                  <div className="text-center mb-6">
                      <h3 className="font-bold text-xl text-slate-900 mb-2">Edit Party Name</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">Management password required.</p>
                  </div>

                  <div className="space-y-3">
                      <input 
                          type="text" 
                          placeholder="New Name" 
                          value={newPartyName} 
                          onChange={(e) => setNewPartyName(e.target.value)} 
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 font-medium focus:outline-none focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 transition-all shadow-sm"
                      />
                      <input 
                          type="password" 
                          placeholder="Admin Password" 
                          value={editNamePassword} 
                          onChange={(e) => setEditNamePassword(e.target.value)} 
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-center font-medium focus:outline-none focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 transition-all shadow-sm"
                      />
                  </div>
                  
                  <div className="flex items-center gap-3 mt-8">
                      <button 
                          onClick={() => { setShowEditNameModal(false); setEditNamePassword(''); }} 
                          className="flex-1 py-3 text-slate-500 font-bold hover:text-slate-800 transition-colors text-sm"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={confirmNameUpdate} 
                          className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 text-sm active:scale-95"
                      >
                          Update
                      </button>
                  </div>
               </div>
          </div>
      )}

      {showExportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
               <div className="bg-white rounded-3xl p-8 w-full max-w-[360px] shadow-2xl border border-slate-100 animate-slide-up transform transition-all">
                  <div className="mx-auto w-14 h-14 bg-gold-50 rounded-full flex items-center justify-center mb-5 text-gold-600 shadow-inner">
                      <Lock className="w-7 h-7" />
                  </div>
                  
                  <div className="text-center mb-6">
                      <h3 className="font-bold text-xl text-slate-900 mb-2">Secure Export</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">Management password required.</p>
                  </div>

                  <input 
                      type="password" 
                      placeholder="Password" 
                      value={exportPassword} 
                      onChange={(e) => setExportPassword(e.target.value)} 
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-center font-medium focus:outline-none focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 transition-all shadow-sm"
                      autoFocus
                  />
                  
                  <div className="flex items-center gap-3 mt-8">
                      <button 
                          onClick={() => { setShowExportModal(false); setExportPassword(''); setPendingExport(null); }} 
                          className="flex-1 py-3 text-slate-500 font-bold hover:text-slate-800 transition-colors text-sm"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={confirmExport} 
                          className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 text-sm active:scale-95"
                      >
                          Verify
                      </button>
                  </div>
               </div>
          </div>
      )}
    </>
  );
}

export default App;
