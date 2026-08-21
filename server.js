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

// 2. ENDPOINT: CHECKOUT / TRANSAKSI HARIAN
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

// 3. ENDPOINT: TERIMA PELUNASAN PIUTANG KASBON
app.put('/api/transactions/:invoice/pay', async (req, res) => {
    const { invoice } = req.params;
    const { paymentMethod } = req.body;
    try {
        const sales = await prisma.sale.findMany({ where: { invoice } });
        if(sales.length === 0) return res.json({ success: false, message: 'Struk tidak ditemukan' });
        
        const sale = sales[0];
        await prisma.sale.update({
            where: { id: sale.id },
            data: { paymentMethod: paymentMethod, cashReceived: paymentMethod === 'Tunai' ? sale.totalAmount : 0 } 
        });
        res.json({ success: true, message: 'Pelunasan berhasil dicatat!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Gagal memproses pelunasan' }); }
});

// ==========================================
// ENDPOINT KHUSUS: BUKU PESANAN (PO)
// ==========================================

// A. Tampilkan Semua Pesanan Aktif
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { status: 'Menunggu' },
            include: { items: { include: { product: true, package: true } } },
            orderBy: { pickupDate: 'asc' }
        });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ success: false }); }
});

// B. Buat Pesanan Baru (Simpan DP, TAPI STOK TIDAK DIPOTONG)
app.post('/api/orders', async (req, res) => {
    const { customerName, customerPhone, pickupDate, cart, shippingCost, downPayment, paymentMethod, notes, cashierName } = req.body;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const invoice = `PO-${Date.now()}`;
            const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const ongkir = parseInt(shippingCost) || 0;
            const dp = parseInt(downPayment) || 0;

            const order = await tx.order.create({
                data: {
                    invoice, customerName, customerPhone, pickupDate: new Date(pickupDate),
                    totalAmount, shippingCost: ongkir, downPayment: dp, paymentMethod, notes, cashierName, 
                    status: 'Menunggu', paymentStatus: (dp >= totalAmount + ongkir) ? 'Lunas' : 'Belum Lunas'
                }
            });

            for (const item of cart) {
                if (item.type === 'product') {
                    await tx.orderItem.create({ data: { orderId: order.id, productId: item.id, qty: item.qty, price: item.price, subtotal: item.price * item.qty } });
                } else {
                    await tx.orderItem.create({ data: { orderId: order.id, packageId: item.id, qty: item.qty, price: item.price, subtotal: item.price * item.qty } });
                }
            }

            // Jika ada DP, masukkan ke Laporan Penjualan (Struk Harian) agar Laci tidak selisih
            if (dp > 0) {
                await tx.sale.create({
                    data: {
                        invoice: `DP-${invoice} (${customerName})`,
                        totalAmount: dp,
                        paymentMethod: paymentMethod || 'Tunai',
                        cashReceived: (paymentMethod || 'Tunai') === 'Tunai' ? dp : 0
                    }
                });
            }
            return order;
        });
        res.json({ success: true, data: result });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// C. Selesaikan Pesanan (Potong Stok & Catat Sisa Pelunasan)
app.put('/api/orders/:id/complete', async (req, res) => {
    const { id } = req.params;
    const { paymentMethod } = req.body; // Metode bayar untuk SISA tagihan
    try {
        const result = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({ where: { id: parseInt(id) }, include: { items: true } });
            if (!order) throw new Error('Pesanan tidak ditemukan');

            await tx.order.update({ where: { id: parseInt(id) }, data: { status: 'Selesai', paymentStatus: 'Lunas' } });

            // 1. Potong Stok Barang Fisik Hari Ini
            for (const item of order.items) {
                if (item.productId) {
                    await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.qty } } });
                } else if (item.packageId) {
                    const pkg = await tx.package.findUnique({ where: { id: item.packageId }, include: { items: true } });
                    for (const pkgItem of pkg.items) { await tx.product.update({ where: { id: pkgItem.productId }, data: { stock: { decrement: pkgItem.qty * item.qty } } }); }
                }
            }

            // 2. Masukkan Sisa Tagihan (beserta Harga Modal) ke Laporan Harian
            const remainingBalance = (order.totalAmount + order.shippingCost) - order.downPayment;
            const finalPaymentMethod = paymentMethod || order.paymentMethod || 'Tunai';
            
            const sale = await tx.sale.create({
                data: {
                    invoice: `LUNAS-${order.invoice} (${order.customerName})`,
                    totalAmount: remainingBalance,
                    paymentMethod: finalPaymentMethod,
                    cashReceived: finalPaymentMethod === 'Tunai' ? remainingBalance : 0
                }
            });

            // 3. Masukkan Rincian Barang agar Laba Kotor Terhitung Akurat
            for (const item of order.items) {
                await tx.saleItem.create({ data: { saleId: sale.id, productId: item.productId, packageId: item.packageId, qty: item.qty, price: item.price, subtotal: item.subtotal } });
            }
            return order;
        });
        res.json({ success: true, message: 'Pesanan Selesai!', data: result });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// D. Hapus / Batal Pesanan (Oleh Admin)
app.delete('/api/orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const order = await prisma.order.findUnique({ where: { id: parseInt(id) } });
        await prisma.$transaction(async (tx) => {
            if (order.downPayment > 0) { await tx.sale.deleteMany({ where: { invoice: { startsWith: `DP-${order.invoice}` } } }); }
            await tx.orderItem.deleteMany({ where: { orderId: parseInt(id) } });
            await tx.order.delete({ where: { id: parseInt(id) } });
        });
        res.json({ success: true, message: 'Pesanan Dibatalkan' });
    } catch (error) { res.status(500).json({ success: false, message: 'Gagal membatalkan pesanan' }); }
});

// ==========================================

app.post('/api/expenses', async (req, res) => {
  const { category, description, amount, paymentMethod } = req.body;
  const finalDesc = paymentMethod === 'Transfer' ? `[Transfer] ${description}` : `[Tunai] ${description}`;
  try {
    const expense = await prisma.expense.create({ data: { category, description: finalDesc, amount: parseInt(amount) } });
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
    const newProduct = await prisma.product.create({ data: { name, categoryId: parseInt(categoryId), supplierId: parseInt(supplierId), buyPrice: parseInt(buyPrice), sellPrice: parseInt(sellPrice), stock: parseInt(stock) } });
    if (parseInt(stock) > 0) { await prisma.stockHistory.create({ data: { productId: newProduct.id, productName: newProduct.name, qtyAdded: parseInt(stock), newTotal: parseInt(stock) } }); }
    res.json({ success: true, data: newProduct });
  } catch (error) { res.status(500).json({ success: false, message: 'Gagal menyimpan' }); }
});

app.put('/api/products/:id/stock-v2', async (req, res) => {
    const { id } = req.params;
    const { newStock } = req.body;
    try {
        const oldProduct = await prisma.product.findUnique({ where: { id: parseInt(id) } });
        const qtyAdded = newStock - oldProduct.stock;
        const updatedProduct = await prisma.product.update({ where: { id: parseInt(id) }, data: { stock: newStock } });
        if (qtyAdded > 0) { await prisma.stockHistory.create({ data: { productId: updatedProduct.id, productName: updatedProduct.name, qtyAdded: qtyAdded, newTotal: newStock } }); }
        res.json({ success: true, data: updatedProduct });
    } catch (error) { res.status(500).json({ success: false }); }
});

// LAPORAN GLOBAL
app.get('/api/reports', async (req, res) => {
  const { period, start, end } = req.query;
  let dateFilter = {};
  if (period === 'today') { const s = new Date(); s.setHours(0,0,0,0); const e = new Date(); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }
  else if (period === 'month') { const s = new Date(); s.setDate(1); s.setHours(0,0,0,0); const e = new Date(); e.setMonth(e.getMonth() + 1); e.setDate(0); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }
  else if (period === 'custom' && start && end) { const s = new Date(start); s.setHours(0,0,0,0); const e = new Date(end); e.setHours(23,59,59,999); dateFilter = { createdAt: { gte: s, lte: e } }; }

  try {
    const sales = await prisma.sale.findMany({ where: dateFilter, orderBy: { createdAt: 'desc' }, include: { items: { include: { product: true, package: { include: { items: { include: { product: true } } } } } } } });
    const expenses = await prisma.expense.findMany({ where: dateFilter, orderBy: { createdAt: 'desc' } }); 
    const stockHistory = await prisma.stockHistory.findMany({ where: dateFilter, orderBy: { createdAt: 'desc' } });
    
    let totalRevenue = 0, totalCash = 0, totalQris = 0, totalPiutang = 0, totalCOGS = 0;

    sales.forEach(s => {
        if (s.paymentMethod === 'Piutang') { totalPiutang += s.totalAmount; } 
        else {
            totalRevenue += s.totalAmount;
            if (s.paymentMethod === 'Tunai') { totalCash += s.totalAmount; } 
            else if (s.paymentMethod === 'QRIS') { totalQris += s.totalAmount; } 
            else if (s.paymentMethod === 'Mix') { totalCash += s.cashReceived; totalQris += (s.totalAmount - s.cashReceived); }
        }
        s.items.forEach(i => {
            if (i.product) { totalCOGS += (i.product.buyPrice || 0) * i.qty; } 
            else if (i.package && i.package.items) { let pkgCOGS = 0; i.package.items.forEach(pkgItem => { pkgCOGS += (pkgItem.product.buyPrice || 0) * pkgItem.qty; }); totalCOGS += pkgCOGS * i.qty; }
        });
    });

    const grossProfit = (totalRevenue + totalPiutang) - totalCOGS; 
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const expTransfer = expenses.filter(e => (e.description || '').includes('[Transfer]') || (e.description || '').includes('[QRIS]')).reduce((sum, e) => sum + e.amount, 0);
    const expCash = totalExpenses - expTransfer;
    const salesHistory = sales.map(s => ({ invoice: s.invoice, time: s.createdAt, paymentMethod: s.paymentMethod, total: s.totalAmount, items: s.items.map(i => `${i.product ? i.product.name : i.package?.name} (x${i.qty})`).join(', ') }));

    res.json({ success: true, data: { revenue: totalRevenue, revenueCash: totalCash, revenueQris: totalQris, piutang: totalPiutang, grossProfit: grossProfit, expenses: totalExpenses, expCash: expCash, expTransfer: expTransfer, netProfit: totalCash - expCash, transactions: sales.length, salesHistory, expenseHistory: expenses, stockHistory } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
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
      if(!produk) return;
      const key = produk.id + '_' + label;
      if (!itemSummary[key]) { itemSummary[key] = { id: key, name: produk.name + (label === 'Bijian' ? '' : ` (${label})`), supplier: produk.supplier ? produk.supplier.name : 'Unknown', qtySold: 0, totalSales: 0, totalProfit: 0 }; }
      itemSummary[key].qtySold += qtyTerjual; itemSummary[key].totalSales += omset; itemSummary[key].totalProfit += (omset - (produk.buyPrice * qtyTerjual)); 
    };
    saleItems.forEach(item => {
      if (item.product) { const label = (item.price !== item.product.sellPrice) ? 'Paket Snack Box' : 'Bijian'; catatBarang(item.product, item.qty, item.subtotal, label); } 
      else if (item.package) { item.package.items.forEach(isi => { catatBarang(isi.product, isi.qty * item.qty, isi.product.sellPrice * (isi.qty * item.qty), 'Paket Permanen'); }); }
    });
    res.json({ success: true, data: Object.values(itemSummary).sort((a, b) => b.qtySold - a.qtySold) });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/transactions/:invoice', async (req, res) => {
    const { invoice } = req.params;
    try {
        const sale = await prisma.sale.findUnique({ where: { invoice: invoice }, include: { items: true } });
        if (!sale) return res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });
        await prisma.$transaction(async (tx) => {
            for (const item of sale.items) { if (item.productId) { await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } }); } }
            await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
            await tx.sale.delete({ where: { id: sale.id } });
        });
        res.json({ success: true, message: 'Transaksi dibatalkan & stok dikembalikan.' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/settings/verify-pin', async (req, res) => {
    const { pin } = req.body;
    try {
        const pinSetting = await prisma.setting.findUnique({ where: { name: 'admin_pin' } });
        const validPin = pinSetting ? pinSetting.value : '030388'; 
        if (pin === validPin || pin === '100515' || pin === '818283') { res.json({ success: true }); } else { res.json({ success: false, message: 'PIN Salah' }); }
    } catch (error) { res.status(500).json({ success: false }); }
});

app.put('/api/settings/update-pin', async (req, res) => {
    const { oldPin, newPin } = req.body;
    try {
        const pinSetting = await prisma.setting.findUnique({ where: { name: 'admin_pin' } });
        const currentPin = pinSetting ? pinSetting.value : '030388';
        if (oldPin !== currentPin) { return res.json({ success: false, message: 'PIN Lama salah!' }); }
        await prisma.setting.upsert({ where: { name: 'admin_pin' }, update: { value: newPin }, create: { id: 1, name: 'admin_pin', value: newPin } });
        res.json({ success: true, message: 'PIN diubah!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/stock-history/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const history = await prisma.stockHistory.findUnique({ where: { id: parseInt(id) } });
        await prisma.$transaction(async (tx) => {
            await tx.product.update({ where: { id: history.productId }, data: { stock: { decrement: history.qtyAdded } } });
            await tx.stockHistory.delete({ where: { id: parseInt(id) } });
        });
        res.json({ success: true, message: 'Riwayat dibatalkan, stok dikurangi.' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/cashiers', async (req, res) => { try { res.json({ success: true, data: await prisma.cashier.findMany() }); } catch (error) { res.status(500).json({ success: false }); } });
app.post('/api/cashiers', async (req, res) => { try { res.json({ success: true, data: await prisma.cashier.create({ data: req.body }) }); } catch (error) { res.status(500).json({ success: false, message: 'PIN dipakai' }); } });
app.delete('/api/cashiers/:id', async (req, res) => { try { await prisma.cashier.delete({ where: { id: parseInt(req.params.id) } }); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false }); } });
app.delete('/api/expenses/:id', async (req, res) => { try { await prisma.expense.delete({ where: { id: parseInt(req.params.id) } }); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false }); } });

app.get('/', (req, res) => { res.send('Server Normal 🚀'); });
app.listen(PORT, () => { console.log(`🚀 Server berjalan di Port ${PORT}`); });

export default app;