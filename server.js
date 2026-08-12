import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

process.env.TZ = "Asia/Makassar";

const app = express();
const prisma = new PrismaClient();
const PORT = 5000; 

app.use(cors()); 
app.use(express.json()); 

// 1. ENDPOINT: KATALOG KASIR
app.get('/api/catalog', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ include: { category: true, supplier: true } });
    const packages = await prisma.package.findMany({ include: { items: { include: { product: true } } } });
    res.json({ success: true, data: { products, packages } });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal mengambil katalog' }); }
});

// 2. ENDPOINT: CHECKOUT / TRANSAKSI
app.post('/api/checkout', async (req, res) => {
  const { cart, paymentMethod, cashReceived, totalAmount, isPackage, customerName } = req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const prefix = isPackage ? 'PKT-' : 'INV-';
      const invoiceNumber = customerName ? `${prefix}${Date.now()} (${customerName})` : `${prefix}${Date.now()}`;
      
      const sale = await tx.sale.create({
        data: { invoice: invoiceNumber, totalAmount, paymentMethod, cashReceived: cashReceived || 0 }
      });

      for (const item of cart) {
        if (item.type === 'product') {
          await tx.product.update({ where: { id: item.id }, data: { stock: { decrement: item.qty } } });
          await tx.saleItem.create({ data: { saleId: sale.id, productId: item.id, qty: item.qty, price: item.price, subtotal: item.price * item.qty } });
        } else if (item.type === 'package') {
          const packageInfo = await tx.package.findUnique({ where: { id: item.id }, include: { items: true } });
          for (const pkgItem of packageInfo.items) {
            await tx.product.update({ where: { id: pkgItem.productId }, data: { stock: { decrement: pkgItem.qty * item.qty } } });
          }
          await tx.saleItem.create({ data: { saleId: sale.id, packageId: item.id, qty: item.qty, price: item.price, subtotal: item.price * item.qty } });
        }
      }
      return sale;
    });
    res.json({ success: true, message: 'Sukses', data: result });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// 3. ENDPOINT: PENGELUARAN (PISAH TUNAI & TRANSFER)
app.post('/api/expenses', async (req, res) => {
  const { category, description, amount, paymentMethod } = req.body;
  const finalDesc = paymentMethod === 'Transfer' ? `[Transfer] ${description}` : `[Tunai] ${description}`;
  try {
    const expense = await prisma.expense.create({ data: { category, description: finalDesc, amount: parseInt(amount) } });
    res.json({ success: true, data: expense });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 4. ENDPOINT: OPSI KATEGORI & SUPPLIER 
app.get('/api/options', async (req, res) => {
  try {
    const categories = await prisma.category.findMany();
    const suppliers = await prisma.supplier.findMany();
    res.json({ success: true, data: { categories, suppliers } });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 5. ENDPOINT: TAMBAH PRODUK DENGAN HARGA BELI
app.post('/api/products', async (req, res) => {
  const { name, categoryId, supplierId, buyPrice, sellPrice, stock } = req.body;
  try {
    const newProduct = await prisma.product.create({
      data: { name, categoryId: parseInt(categoryId), supplierId: parseInt(supplierId), buyPrice: parseInt(buyPrice), sellPrice: parseInt(sellPrice), stock: parseInt(stock) }
    });
    
    if (parseInt(stock) > 0) {
        await prisma.stockHistory.create({
            data: { productId: newProduct.id, productName: newProduct.name, qtyAdded: parseInt(stock), newTotal: parseInt(stock) }
        });
    }
    res.json({ success: true, data: newProduct });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal menyimpan produk' }); }
});

// 6. ENDPOINT: UPDATE STOK V2 & RIWAYAT MASUK
app.put('/api/products/:id/stock-v2', async (req, res) => {
    const { id } = req.params;
    const { newStock } = req.body;
    try {
        const oldProduct = await prisma.product.findUnique({ where: { id: parseInt(id) } });
        if (!oldProduct) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });

        const qtyAdded = newStock - oldProduct.stock;
        const updatedProduct = await prisma.product.update({ where: { id: parseInt(id) }, data: { stock: newStock } });

        if (qtyAdded > 0) {
            await prisma.stockHistory.create({
                data: { productId: updatedProduct.id, productName: updatedProduct.name, qtyAdded: qtyAdded, newTotal: newStock }
            });
        }
        res.json({ success: true, data: updatedProduct });
    } catch (error) { res.status(500).json({ success: false, message: 'Gagal update stok' }); }
});

// 7. ENDPOINT: LAPORAN GLOBAL & RIWAYAT STRUK
app.get('/api/reports', async (req, res) => {
  const { period, start, end } = req.query;
  let dateFilter = {};

  if (period === 'today') {
    const startDate = new Date(); startDate.setHours(0,0,0,0);
    const endDate = new Date(); endDate.setHours(23,59,59,999);
    dateFilter = { createdAt: { gte: startDate, lte: endDate } };
  } else if (period === 'month') {
    const startDate = new Date(); startDate.setDate(1); startDate.setHours(0,0,0,0);
    const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(0); endDate.setHours(23,59,59,999);
    dateFilter = { createdAt: { gte: startDate, lte: endDate } };
  } else if (period === 'custom' && start && end) {
    const startDate = new Date(start); startDate.setHours(0,0,0,0);
    const endDate = new Date(end); endDate.setHours(23,59,59,999);
    dateFilter = { createdAt: { gte: startDate, lte: endDate } };
  }

  try {
    const sales = await prisma.sale.findMany({ 
      where: dateFilter, orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true, package: true } } }
    });
    const expenses = await prisma.expense.findMany({ where: dateFilter, orderBy: { createdAt: 'desc' } }); 
    const stockHistory = await prisma.stockHistory.findMany({ where: dateFilter, orderBy: { createdAt: 'desc' } });
    
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalCash = sales.filter(s => s.paymentMethod === 'Tunai').reduce((sum, s) => sum + s.totalAmount, 0);
    const totalQris = sales.filter(s => s.paymentMethod === 'QRIS').reduce((sum, s) => sum + s.totalAmount, 0);

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const expTransfer = expenses.filter(e => (e.description || '').includes('[Transfer]') || (e.description || '').includes('[QRIS]')).reduce((sum, e) => sum + e.amount, 0);
    const expCash = totalExpenses - expTransfer;

    const salesHistory = sales.map(s => ({
      invoice: s.invoice, time: s.createdAt, paymentMethod: s.paymentMethod, total: s.totalAmount,
      items: s.items.map(i => `${i.product ? i.product.name : i.package?.name} (x${i.qty})`).join(', ')
    }));

    res.json({
      success: true,
      data: { 
        revenue: totalRevenue, revenueCash: totalCash, revenueQris: totalQris,
        expenses: totalExpenses, expCash: expCash, expTransfer: expTransfer,
        netProfit: totalCash - expCash, transactions: sales.length, 
        salesHistory, expenseHistory: expenses, stockHistory 
      }
    });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 8. ENDPOINT: LAPORAN ITEM TERJUAL
app.get('/api/reports/items', async (req, res) => {
  const { period, start, end } = req.query;
  let dateFilter = {};
  if (period === 'today') { const s = new Date(); s.setHours(0,0,0,0); const e = new Date(); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }
  else if (period === 'month') { const s = new Date(); s.setDate(1); s.setHours(0,0,0,0); const e = new Date(); e.setMonth(e.getMonth() + 1); e.setDate(0); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }
  else if (period === 'custom' && start && end) { const s = new Date(start); s.setHours(0,0,0,0); const e = new Date(end); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }

  try {
    const saleItems = await prisma.saleItem.findMany({ where: { sale: dateFilter }, include: { product: { include: { supplier: true } }, package: { include: { items: { include: { product: { include: { supplier: true } } } } } } } });
    const itemSummary = {};
    const catatBarang = (produk, qtyTerjual, omset, label) => {
      if(!produk) return;
      const key = produk.id + '_' + label;
      if (!itemSummary[key]) { itemSummary[key] = { id: key, name: produk.name + (label === 'Bijian' ? '' : ` (${label})`), supplier: produk.supplier ? produk.supplier.name : 'Unknown', qtySold: 0, totalSales: 0 }; }
      itemSummary[key].qtySold += qtyTerjual; itemSummary[key].totalSales += omset;
    };
    saleItems.forEach(item => {
      if (item.product) { const label = (item.price !== item.product.sellPrice) ? 'Paket Snack Box' : 'Bijian'; catatBarang(item.product, item.qty, item.subtotal, label); } 
      else if (item.package) { item.package.items.forEach(isi => { catatBarang(isi.product, isi.qty * item.qty, isi.product.sellPrice * (isi.qty * item.qty), 'Paket Permanen'); }); }
    });
    res.json({ success: true, data: Object.values(itemSummary).sort((a, b) => b.qtySold - a.qtySold) });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 9. ENDPOINT: HAPUS STRUK & KEMBALIKAN STOK
app.delete('/api/transactions/:invoice', async (req, res) => {
    const { invoice } = req.params;
    try {
        const sale = await prisma.sale.findUnique({ where: { invoice: invoice }, include: { items: true } });
        if (!sale) return res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });

        await prisma.$transaction(async (tx) => {
            for (const item of sale.items) {
                if (item.productId) { await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } }); }
            }
            await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
            await tx.sale.delete({ where: { id: sale.id } });
        });
        res.json({ success: true, message: 'Transaksi dibatalkan & stok otomatis dikembalikan.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat membatalkan struk.' }); }
});

// 10. ENDPOINT: PENGATURAN PIN ADMIN (3 PIN UTAMA)
app.post('/api/settings/verify-pin', async (req, res) => {
    const { pin } = req.body;
    try {
        const pinSetting = await prisma.setting.findUnique({ where: { name: 'admin_pin' } });
        const validPin = pinSetting ? pinSetting.value : '030388'; 
        
        // Cek PIN Utama di Database ATAU PIN Cadangan
        if (pin === validPin || pin === '100515' || pin === '818283') { res.json({ success: true }); } else { res.json({ success: false, message: 'PIN Salah' }); }
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.put('/api/settings/update-pin', async (req, res) => {
    const { oldPin, newPin } = req.body;
    try {
        const pinSetting = await prisma.setting.findUnique({ where: { name: 'admin_pin' } });
        const currentPin = pinSetting ? pinSetting.value : '030388';

        if (oldPin !== currentPin) { return res.json({ success: false, message: 'PIN Lama salah!' }); }

        await prisma.setting.upsert({
            where: { name: 'admin_pin' }, update: { value: newPin }, create: { id: 1, name: 'admin_pin', value: newPin }
        });
        res.json({ success: true, message: 'PIN berhasil diubah!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Gagal mengubah PIN' }); }
});

// 11. ENDPOINT: HAPUS RIWAYAT STOK
app.delete('/api/stock-history/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const history = await prisma.stockHistory.findUnique({ where: { id: parseInt(id) } });
        if (!history) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        await prisma.$transaction(async (tx) => {
            await tx.product.update({ where: { id: history.productId }, data: { stock: { decrement: history.qtyAdded } } });
            await tx.stockHistory.delete({ where: { id: parseInt(id) } });
        });
        res.json({ success: true, message: 'Riwayat dibatalkan, stok dikurangi.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Gagal membatalkan riwayat' }); }
});

// 12. ENDPOINT: MANAJEMEN KASIR
app.get('/api/cashiers', async (req, res) => {
  try { const cashiers = await prisma.cashier.findMany(); res.json({ success: true, data: cashiers }); } 
  catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/cashiers', async (req, res) => {
  try { const newCashier = await prisma.cashier.create({ data: req.body }); res.json({ success: true, data: newCashier }); } 
  catch (error) { res.status(500).json({ success: false, message: 'PIN sudah dipakai' }); }
});

app.delete('/api/cashiers/:id', async (req, res) => {
  try { await prisma.cashier.delete({ where: { id: parseInt(req.params.id) } }); res.json({ success: true }); } 
  catch (error) { res.status(500).json({ success: false }); }
});

// 13. ENDPOINT BARU: HAPUS PENGELUARAN
app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.expense.delete({ where: { id: parseInt(id) } });
    res.json({ success: true, message: 'Pengeluaran berhasil dihapus' });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal menghapus pengeluaran' }); }
});

app.get('/', (req, res) => { res.send('Server Normal 🚀'); });
app.listen(PORT, () => { console.log(`🚀 Server berjalan di Port ${PORT}`); });

export default app;