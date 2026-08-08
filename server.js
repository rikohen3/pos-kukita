import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(cors()); 
app.use(express.json()); 

app.get('/api/catalog', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ include: { category: true, supplier: true } });
    const packages = await prisma.package.findMany({ where: { isActive: true } });
    res.json({ success: true, data: { products, packages } });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal mengambil katalog' }); }
});

app.post('/api/checkout', async (req, res) => {
  const { cart, paymentMethod, cashReceived, totalAmount, isPackage } = req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // TRIK CERDAS: JIKA PAKET, UBAH NOMOR INVOICE JADI PKT-
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

app.post('/api/expenses', async (req, res) => {
  const { category, description, amount } = req.body;
  try {
    const expense = await prisma.expense.create({ data: { category, description, amount: parseInt(amount) } });
    res.json({ success: true, data: expense });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/options', async (req, res) => {
  try {
    const categories = await prisma.category.findMany();
    const suppliers = await prisma.supplier.findMany();
    res.json({ success: true, data: { categories, suppliers } });
  } catch (error) { res.status(500).json({ success: false }); }
});

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

app.put('/api/products/:id/stock', async (req, res) => {
  try {
    const updated = await prisma.product.update({ where: { id: parseInt(req.params.id) }, data: { stock: parseInt(req.body.newStock) } });
    res.json({ success: true, data: updated });
  } catch (error) { res.status(500).json({ success: false }); }
});

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
    const expenses = await prisma.expense.findMany({ where: dateFilter });
    
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    const salesHistory = sales.map(s => {
      return {
        invoice: s.invoice,
        time: s.createdAt,
        paymentMethod: s.paymentMethod,
        total: s.totalAmount,
        items: s.items.map(i => `${i.product ? i.product.name : i.package?.name} (x${i.qty})`).join(', ')
      };
    });

    res.json({
      success: true,
      data: { revenue: totalRevenue, expenses: totalExpenses, netProfit: totalRevenue - totalExpenses, transactions: sales.length, salesHistory }
    });
  } catch (error) { res.status(500).json({ success: false }); }
});

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

app.get('/', (req, res) => { res.send('Server Normal 🚀'); });

export default app;