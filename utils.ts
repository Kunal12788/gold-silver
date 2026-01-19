
import { InventoryBatch, Invoice, AgingStats, SupplierStat, TurnoverStats, AuditReport } from './types';

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatGrams = (grams: number) => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(grams) + ' g';
};

export const generateId = () => Math.random().toString(36).substr(2, 9);

export const getDateDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

export const downloadCSV = (csvContent: string, filename: string) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the Data-URL declaration (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

/**
 * Calculates the inventory state (Quantity and Value) on a specific historical date.
 * Returns an object with grams and value.
 */
export const getInventorySnapshot = (invoices: Invoice[], targetDate: string) => {
  // Filter invoices up to targetDate and sort strictly by date + timestamp
  const relevantInvoices = invoices
    .filter(inv => inv.date <= targetDate)
    .sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        
        if (a.createdAt && b.createdAt) {
            const timeComp = a.createdAt.localeCompare(b.createdAt);
            if (timeComp !== 0) return timeComp;
        }
        
        return a.id.localeCompare(b.id);
    });

  let batches: { quantity: number; cost: number }[] = [];
  let totalQuantity = 0;

  for (const inv of relevantInvoices) {
    if (inv.type === 'PURCHASE') {
      batches.push({ quantity: inv.quantityGrams, cost: inv.ratePerGram });
      totalQuantity += inv.quantityGrams;
    } else {
      let remainingToSell = inv.quantityGrams;
      totalQuantity -= inv.quantityGrams;
      
      while (remainingToSell > 0.000001 && batches.length > 0) {
        const currentBatch = batches[0];
        
        if (currentBatch.quantity > remainingToSell) {
          currentBatch.quantity -= remainingToSell;
          remainingToSell = 0;
        } else {
          remainingToSell -= currentBatch.quantity;
          batches.shift(); 
        }
      }
    }
  }

  // Calculate total value of remaining batches
  const totalValue = batches.reduce((sum, batch) => sum + (batch.quantity * batch.cost), 0);

  return {
    grams: Math.max(0, totalQuantity),
    value: totalValue
  };
};

/**
 * Replays transactions up to a specific date to calculate the FIFO inventory value at that time.
 */
export const calculateInventoryValueOnDate = (invoices: Invoice[], targetDate: string): number => {
  return getInventorySnapshot(invoices, targetDate).value;
};

export const calculateStockAging = (inventory: InventoryBatch[]): AgingStats => {
  const now = new Date();
  const buckets: Record<string, number> = {
    '0-7': 0,
    '8-15': 0,
    '16-30': 0,
    '30+': 0
  };
  let totalDaysWeighted = 0;
  let totalStock = 0;

  inventory.forEach(batch => {
    if (batch.remainingQuantity <= 0) return;
    
    const batchDate = new Date(batch.date);
    const diffTime = Math.abs(now.getTime() - batchDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    totalStock += batch.remainingQuantity;
    totalDaysWeighted += (diffDays * batch.remainingQuantity);

    if (diffDays <= 7) buckets['0-7'] += batch.remainingQuantity;
    else if (diffDays <= 15) buckets['8-15'] += batch.remainingQuantity;
    else if (diffDays <= 30) buckets['16-30'] += batch.remainingQuantity;
    else buckets['30+'] += batch.remainingQuantity;
  });

  return {
    buckets,
    weightedAvgDays: totalStock > 0 ? totalDaysWeighted / totalStock : 0
  };
};

export const calculateSupplierStats = (invoices: Invoice[]): SupplierStat[] => {
  const stats: Record<string, { totalGrams: number; totalCost: number; count: number; rates: number[] }> = {};
  
  invoices.filter(i => i.type === 'PURCHASE').forEach(inv => {
    if (!stats[inv.partyName]) {
      stats[inv.partyName] = { totalGrams: 0, totalCost: 0, count: 0, rates: [] };
    }
    stats[inv.partyName].totalGrams += inv.quantityGrams;
    stats[inv.partyName].totalCost += (inv.quantityGrams * inv.ratePerGram);
    stats[inv.partyName].count += 1;
    stats[inv.partyName].rates.push(inv.ratePerGram);
  });

  return Object.entries(stats).map(([name, data]) => {
      const minRate = Math.min(...data.rates);
      const maxRate = Math.max(...data.rates);
      const avgRate = data.totalGrams > 0 ? data.totalCost / data.totalGrams : 0;
      // Simple spread as volatility for now, could use StdDev if needed
      const volatility = maxRate - minRate;

      return {
        name,
        totalGramsPurchased: data.totalGrams,
        avgRate,
        minRate,
        maxRate,
        volatility,
        txCount: data.count
      };
  }).sort((a, b) => b.totalGramsPurchased - a.totalGramsPurchased);
};

export const calculateTurnoverStats = (invoices: Invoice[], startDate: string, endDate: string): TurnoverStats => {
  const periodInvoices = invoices.filter(i => i.date >= startDate && i.date <= endDate);
  const sales = periodInvoices.filter(i => i.type === 'SALE');
  
  const totalCOGS = sales.reduce((acc, s) => acc + (s.cogs || 0), 0);
  
  const startInventoryVal = calculateInventoryValueOnDate(invoices, startDate);
  const endInventoryVal = calculateInventoryValueOnDate(invoices, endDate);
  const avgInventoryValue = (startInventoryVal + endInventoryVal) / 2;

  const turnoverRatio = avgInventoryValue > 0 ? totalCOGS / avgInventoryValue : 0;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysInPeriod = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 3600 * 24));
  
  const avgDaysToSell = turnoverRatio > 0 ? daysInPeriod / turnoverRatio : 0;

  return {
    turnoverRatio,
    avgDaysToSell,
    avgInventoryValue,
    totalCOGS
  };
};

export const performFullSystemAudit = (invoices: Invoice[], currentStock: number, currentValue: number): AuditReport => {
    const issues: string[] = [];
    let score = 100;
    
    // 1. Recalculate Stock from scratch
    const stockCheck = invoices.reduce((acc, inv) => {
        if (inv.type === 'PURCHASE') return acc + inv.quantityGrams;
        else return acc - inv.quantityGrams;
    }, 0);
  
    if (Math.abs(stockCheck - currentStock) > 0.001) {
        issues.push(`Stock Mismatch: Calculated ${stockCheck.toFixed(3)}g vs Expected ${currentStock.toFixed(3)}g`);
        score -= 20;
    }
  
    // 2. Check for negative stock events (chronological check)
    const sorted = [...invoices].sort((a, b) => a.date.localeCompare(b.date));
    let runningStock = 0;
    let negativeStockCount = 0;
    
    for (const inv of sorted) {
        if (inv.type === 'PURCHASE') runningStock += inv.quantityGrams;
        else runningStock -= inv.quantityGrams;
        
        if (runningStock < -0.0001) {
            negativeStockCount++;
        }
    }
  
    if (negativeStockCount > 0) {
        issues.push(`Negative Stock Detected: ${negativeStockCount} instances where stock dipped below zero.`);
        score -= 15;
    }
  
    // 3. Data Integrity
    const missingFields = invoices.filter(i => !i.partyName || !i.date || i.quantityGrams <= 0 || i.ratePerGram <= 0);
    if (missingFields.length > 0) {
        issues.push(`Data Integrity: ${missingFields.length} records have missing or invalid critical fields.`);
        score -= 10;
    }
  
    return {
        generatedAt: new Date().toISOString(),
        totalInvoices: invoices.length,
        dataIntegrityIssues: issues,
        healthScore: Math.max(0, score),
        recalculatedStock: stockCheck,
        recalculatedValue: currentValue
    };
  };

// Robust parser to extract data from the provided OCR text format
export const parseInvoiceOCR = (text: string) => {
  try {
    const lines = text.split('\n');
    let date = '';
    let partyName = '';
    let quantity = 0;
    let rate = 0;
    let gstRate = 0;
    let gstAmount = 0;
    let isSale = false; 

    // 1. Determine Transaction Type
    if (text.includes('ORIGINAL FOR RECIPIENT') || text.includes('TAX INVOICE') || /Sale/i.test(text)) {
        isSale = true;
    }

    // 2. Date Extraction
    const normalizeDate = (str: string): string | null => {
        str = str.trim().replace(/,/g, ''); 
        const textMonthMatch = str.match(/^(\d{1,2})[-/\s]+([a-zA-Z]{3,})[-/\s]+(\d{2,4})$/);
        if (textMonthMatch) {
            const day = textMonthMatch[1].padStart(2, '0');
            const monthStr = textMonthMatch[2].substring(0, 3).toLowerCase();
            let year = textMonthMatch[3];
            if (year.length === 2) year = '20' + year; 
            const months: Record<string, string> = {
                jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
            };
            if (months[monthStr]) return `${year}-${months[monthStr]}-${day}`;
        }
        const numMatch = str.match(/^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{2,4})$/);
        if (numMatch) {
            const day = numMatch[1].padStart(2, '0');
            const month = numMatch[2].padStart(2, '0');
            let year = numMatch[3];
            if (year.length === 2) year = '20' + year;
            return `${year}-${month}-${day}`;
        }
        return null;
    };

    const alphaDateMatch = text.match(/\b(\d{1,2})[-/\s]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s,]+(\d{2,4})\b/i);
    const labeledDateMatch = text.match(/(?:Dated|Invoice Date|Date)\s*[:\-\s]+\s*(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})\b/i);
    const strictNumericMatch = text.match(/\b(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{4})\b/);

    if (alphaDateMatch) {
        const normalized = normalizeDate(alphaDateMatch[0]);
        if (normalized) date = normalized;
    } else if (labeledDateMatch) {
        const normalized = normalizeDate(labeledDateMatch[1]);
        if (normalized) date = normalized;
    } else if (strictNumericMatch) {
        const normalized = normalizeDate(strictNumericMatch[1]);
        if (normalized) date = normalized;
    }

    // 3. Party Name Extraction
    const partyPatterns = [
        /(?:Party|Customer|Billed to)\s*[:\-\s](.+)/i,
        /M\/s[\.\s](.+)/i,
        /Name\s*[:\-\s](.+)/i
    ];
    for (const pattern of partyPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            let p = match[1].trim();
            p = p.split(/  |\t/)[0];
            if (p.length > 2 && !/Date|Inv|No\./i.test(p)) {
                partyName = p;
                break;
            }
        }
    }

    // 4. Quantity and Rate Extraction
    const itemLines = lines.filter(l => /Gms|Grams|Qty/i.test(l) && /\d/.test(l));
    for (const line of itemLines) {
        const tokens = line.replace(/[^\d\w\s.,]/g, '').split(/\s+/).filter(t => t);
        const gmsIndex = tokens.findIndex(t => /Gms|Grams/i.test(t));
        
        if (gmsIndex !== -1 && gmsIndex > 0) {
            const q = parseFloat(tokens[gmsIndex - 1].replace(/,/g, ''));
            if (!isNaN(q)) quantity = q;
            const numbers = tokens.map(t => parseFloat(t.replace(/,/g, ''))).filter(n => !isNaN(n));
            const possibleRates = numbers.filter(n => n > 2000 && n < 100000 && n !== quantity);
            if (possibleRates.length > 0) rate = possibleRates[0];
        } else {
             const numbers = line.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/g)?.map(n => parseFloat(n.replace(/,/g, ''))) || [];
             if (numbers.length >= 2) {
                 const potentialRate = numbers.find(n => n > 2000 && n < 100000);
                 const potentialQty = numbers.find(n => n < 1000 && n > 0 && n !== potentialRate);
                 if (potentialRate && potentialQty) {
                     rate = potentialRate;
                     quantity = potentialQty;
                 }
             }
        }
    }

    // 5. GST Extraction
    const taxLines = lines.filter(l => /(?:CGST|SGST|IGST|GST)/i.test(l) && !/GSTIN|No\.|Code|Reg/i.test(l));
    const percentRegex = /(@|at)?\s*(\d+(\.\d+)?)\s*%/i;
    const amountRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g;

    let iGstRate = 0;
    let iGstAmount = 0;
    let cGstRate = 0;
    let cGstAmount = 0;
    let sGstRate = 0;
    let sGstAmount = 0;
    let genericGstRate = 0;
    let genericGstAmount = 0;

    for (const line of taxLines) {
        let lineRate = 0;
        const rateMatch = line.match(percentRegex);
        if (rateMatch) lineRate = parseFloat(rateMatch[2]);

        let lineAmount = 0;
        const amounts = line.match(amountRegex);
        if (amounts && amounts.length > 0) {
             for (let i = amounts.length - 1; i >= 0; i--) {
                 const val = parseFloat(amounts[i].replace(/,/g, ''));
                 if (val > 0 && Math.abs(val - lineRate) > 0.01) {
                     lineAmount = val;
                     break;
                 }
             }
        }

        if (/IGST/i.test(line)) {
            if (lineRate > iGstRate) iGstRate = lineRate;
            iGstAmount += lineAmount;
        } else if (/CGST/i.test(line)) {
             if (lineRate > cGstRate) cGstRate = lineRate;
             cGstAmount += lineAmount;
        } else if (/SGST/i.test(line)) {
             if (lineRate > sGstRate) sGstRate = lineRate;
             sGstAmount += lineAmount;
        } else if (/GST/i.test(line)) {
             if (lineRate > genericGstRate) genericGstRate = lineRate;
             genericGstAmount += lineAmount;
        }
    }

    if (iGstRate > 0) {
        gstRate = iGstRate;
        gstAmount = iGstAmount;
    } else if (cGstRate > 0 || sGstRate > 0) {
        gstRate = cGstRate + sGstRate;
        gstAmount = cGstAmount + sGstAmount;
    } else {
        gstRate = genericGstRate;
        gstAmount = genericGstAmount;
    }

    return { date, partyName, quantity, rate, gstRate: gstRate > 0 ? gstRate : null, gstAmount, isSale };
  } catch (e) {
    console.error("Parse error", e);
    return null;
  }
}
