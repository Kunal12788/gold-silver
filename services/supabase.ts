
import { createClient } from '@supabase/supabase-js';
import { Invoice } from '../types';

// Supabase Credentials (from user prompt)
const SUPABASE_URL = 'https://frwfhwwclbutljjltjkt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GFjJT0VabZ-DFCmPUurA9A_np_ijLwh';

// CONFIGURATION UPDATE:
// We now explicitly use 'window.sessionStorage'.
// This forces the session to expire immediately when the browser tab or window is closed.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: window.sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
});

/**
 * Maps Supabase DB row (snake_case) to Invoice object (camelCase)
 */
const mapOrderFromDB = (o: any): Invoice => ({
  id: o.id,
  date: o.date,
  type: o.type,
  partyName: o.party_name,
  quantityGrams: Number(o.quantity_grams),
  ratePerGram: Number(o.rate_per_gram),
  gstRate: Number(o.gst_rate),
  gstAmount: Number(o.gst_amount),
  taxableAmount: Number(o.taxable_amount),
  totalAmount: Number(o.total_amount),
  cogs: Number(o.cogs || 0),
  profit: Number(o.profit || 0),
  createdAt: o.created_at // Crucial for FIFO ordering
});

/**
 * Maps Invoice object (camelCase) to Supabase DB row (snake_case)
 */
const mapOrderToDB = (invoice: Invoice, userId?: string) => ({
  id: invoice.id,
  date: invoice.date,
  type: invoice.type,
  party_name: invoice.partyName,
  quantity_grams: invoice.quantityGrams,
  rate_per_gram: invoice.ratePerGram,
  gst_rate: invoice.gstRate,
  gst_amount: invoice.gstAmount,
  taxable_amount: invoice.taxableAmount,
  total_amount: invoice.totalAmount,
  cogs: invoice.cogs || 0,
  profit: invoice.profit || 0,
  created_at: invoice.createdAt || new Date().toISOString(),
  updated_at: new Date().toISOString()
});

/**
 * Fetches all orders for the logged-in user.
 * Returns null if there is a database error (e.g., table missing).
 */
export const fetchOrders = async (): Promise<Invoice[] | null> => {
  // Added secondary sort by 'created_at' to ensure deterministic order
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true }); // Important for FIFO reconstruction stability

  if (error) {
    console.error('Error fetching orders:', error);
    return null;
  }

  return data.map(mapOrderFromDB);
};

/**
 * Saves a single order (invoice) to the 'orders' table in Supabase.
 */
export const saveOrderToSupabase = async (invoice: Invoice) => {
  try {
    const payload = mapOrderToDB(invoice);
    // Remove undefined user_id if any, allow DB default
    const { error } = await supabase
      .from('orders')
      .upsert(payload);

    if (error) {
      console.error('Supabase Insert Error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase Connection Error:', err);
    return false;
  }
};

/**
 * Deletes an order by ID.
 */
export const deleteOrderFromSupabase = async (id: string) => {
  const { error } = await supabase.from('orders').delete().eq('id', id);
  if (error) {
      console.error("Delete failed", error);
      return false;
  }
  return true;
};

/**
 * Updates the party name of an order by ID.
 */
export const updateOrderPartyName = async (id: string, newName: string) => {
  const { error } = await supabase
    .from('orders')
    .update({ party_name: newName })
    .eq('id', id);
    
  if (error) {
    console.error("Update failed", error);
    return false;
  }
  return true;
};

/**
 * Bulk inserts orders (used for migrating local storage to cloud).
 */
export const bulkInsertOrders = async (invoices: Invoice[]) => {
  if (invoices.length === 0) return true;
  
  const payload = invoices.map(i => mapOrderToDB(i));
  
  const { error } = await supabase.from('orders').upsert(payload);
  
  if (error) {
    console.error('Bulk Insert Error:', error);
    return false;
  }
  return true;
};
