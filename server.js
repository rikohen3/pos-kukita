import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = 5000; 

app.use(cors()); 
app.use(express.json()); 

// 1. ENDPOINT: KATALOG KASIR
app.get('/api/catalog', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ include: { category: true, supplier: true } });
    const packages = await prisma.package.findMany({ where: { isActive: true } });
    res.json({ success: true, data: { products, packages } });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal mengambil katalog' }); }
});

// 2. ENDPOINT: CHECKOUT / TRANSAKSI
app.post('/api/checkout', async (req, res) => {
  const { cart, paymentMethod, cashReceived, totalAmount, isPackage } = req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // LOGIKA PKT-: Jika isPackage true dari kasir, jadikan PKT-, jika tidak jadikan INV-
      const prefix = isPackage ? 'PKT-' : 'INV-';
      const sale = await tx.sale.create({
        data: { invoice: `${prefix}${Date.now()}`, totalAmount, paymentMethod, cashReceived: cashReceived || 0 }
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

// 3. ENDPOINT: PENGELUARAN
app.post('/api/expenses', async (req, res) => {
  const { category, description, amount } = req.body;
  try {
    const expense = await prisma.expense.create({ data: { category, description, amount: parseInt(amount) } });
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
      data: { 
        name, 
        categoryId: parseInt(categoryId), 
        supplierId: parseInt(supplierId), 
        buyPrice: parseInt(buyPrice),
        sellPrice: parseInt(sellPrice), 
        stock: parseInt(stock) 
      }
    });
    res.json({ success: true, data: newProduct });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal menyimpan produk' }); }
});

// 6. ENDPOINT: UPDATE STOK
app.put('/api/products/:id/stock', async (req, res) => {
  try {
    const updated = await prisma.product.update({ where: { id: parseInt(req.params.id) }, data: { stock: parseInt(req.body.newStock) } });
    res.json({ success: true, data: updated });
  } catch (error) { res.status(500).json({ success: false }); }
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
    
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    // VERSI ORIGINAL 100% AMAN
    const salesHistory = sales.map(s => ({
      invoice: s.invoice,
      time: s.createdAt,
      paymentMethod: s.paymentMethod,
      total: s.totalAmount,
      items: s.items.map(i => `${i.product ? i.product.name : i.package?.name} (x${i.qty})`).join(', ')
    }));

    res.json({
      success: true,
      data: { 
        revenue: totalRevenue, 
        expenses: totalExpenses, 
        netProfit: totalRevenue - totalExpenses, 
        transactions: sales.length, 
        salesHistory,
        expenseHistory: expenses 
      }
    });
  } catch (error) { res.status(500).json({ success: false }); }
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
      const key = produk.id + '_' + label;
      if (!itemSummary[key]) { itemSummary[key] = { id: key, name: produk.name + (label === 'Bijian' ? '' : ` (${label})`), supplier: produk.supplier.name, qtySold: 0, totalSales: 0 }; }
      itemSummary[key].qtySold += qtyTerjual; itemSummary[key].totalSales += omset;
    };
    saleItems.forEach(item => {
      if (item.product) { const label = (item.price !== item.product.sellPrice) ? 'Paket Snack Box' : 'Bijian'; catatBarang(item.product, item.qty, item.subtotal, label); } 
      else if (item.package) { item.package.items.forEach(isi => { catatBarang(isi.product, isi.qty * item.qty, isi.product.sellPrice * (isi.qty * item.qty), 'Paket Permanen'); }); }
    });
    res.json({ success: true, data: Object.values(itemSummary).sort((a, b) => b.qtySold - a.qtySold) });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 9. ENDPOINT BARU: HAPUS STRUK & KEMBALIKAN STOK
app.delete('/api/sales/:invoice', async (req, res) => {
  const invoice = req.params.invoice;
  try {
    const sale = await prisma.sale.findFirst({ where: { invoice: invoice }, include: { items: true } });
    if (!sale) return res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });

    await prisma.$transaction(async (tx) => {
      // 1. Kembalikan stok barang ke gudang
      for (const item of sale.items) {
        if (item.productId) {
          await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } });
        } else if (item.packageId) {
          const pkg = await tx.package.findUnique({ where: { id: item.packageId }, include: { items: true } });
          if (pkg) {
            for (const pkgItem of pkg.items) {
              await tx.product.update({ where: { id: pkgItem.productId }, data: { stock: { increment: pkgItem.qty * item.qty } } });
            }
          }
        }
      }
      // 2. Hapus Rincian Belanjaan (SaleItem)
      await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
      // 3. Hapus Nota Utama (Sale)
      await tx.sale.delete({ where: { id: sale.id } });
    });
    res.json({ success: true, message: 'Struk dihapus & stok telah dikembalikan!' });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal menghapus struk' }); }
});

app.get('/', (req, res) => { res.send('Server Normal 🚀'); });
app.listen(PORT, () => { console.log(`🚀 Server berjalan di Port ${PORT}`); });