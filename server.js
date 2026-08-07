import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// Gunakan Port 5000 untuk server backend
const PORT = 5000; 

// --- MIDDLEWARE ---
// Sangat Krusial! Mengizinkan file HTML kasir di browser mengakses server ini.
app.use(cors()); 
// Mengizinkan server membaca data pesanan yang dikirim dalam format JSON.
app.use(express.json()); 

// --- ENDPOINTS (REST API) ---

// [TAB POS KASIR]
// 1. Endpoint untuk menampilkan Katalog (Produk + Paket) di layar kasir.
app.get('/api/catalog', async (req, res) => {
  try {
    // Ambil semua produk satuan (beserta info supplier dan kategorinya)
    const products = await prisma.product.findMany({
      include: { category: true, supplier: true }
    });
    
    // Ambil semua paket (cth: Snack Box Rapat) yang aktif
    const packages = await prisma.package.findMany({
      where: { isActive: true }
    });
    
    // Kirim datanya kembali ke Kasir
    res.json({ success: true, data: { products, packages } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal mengambil katalog server' });
  }
});

// [MODUL POS KASIR]
// 2. Endpoint Krusial: Proses Pembayaran (Checkout).
app.post('/api/checkout', async (req, res) => {
  // Data dikirim dari keranjang belanja di Kasir
  const { cart, paymentMethod, cashReceived, totalAmount } = req.body;

  try {
    // Jalankan transaksi database (Berasil semua atau batal semua)
    const result = await prisma.$transaction(async (tx) => {
      
      // A. Buat induk transaksi (Sale)
      const sale = await tx.sale.create({
        data: {
          invoice: `INV-${Date.now()}`, // Nomor invoice unik berdasarkan waktu
          totalAmount: totalAmount,
          paymentMethod: paymentMethod,
          cashReceived: cashReceived || 0,
        }
      });

      // B. Proses Item per Item di keranjang belanja
      for (const item of cart) {
        
        if (item.type === 'product') {
          // JIKA BELI PRODUK SATUAN:
          // 1. Kurangi Stok Produk Asli di Gudang
          await tx.product.update({
            where: { id: item.id },
            data: { stock: { decrement: item.qty } }
          });

          // 2. Catat detail penjualannya
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.id,
              qty: item.qty,
              price: item.price,
              subtotal: item.price * item.qty
            }
          });

        } else if (item.type === 'package') {
          // JIKA BELI PAKET (CTH: SNACK BOX):
          // 1. Ambil resep isi paket tersebut
          const packageInfo = await tx.package.findUnique({
            where: { id: item.id },
            include: { items: true } // Ambil data barang asli penyusun paket
          });

          // 2. Potong stok masing-masing isi paket dikali jumlah box yang dibeli
          for (const pkgItem of packageInfo.items) {
            await tx.product.update({
              where: { id: pkgItem.productId },
              data: { stock: { decrement: pkgItem.qty * item.qty } }
            });
          }

          // 3. Catat detail penjualan paket
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              packageId: item.id,
              qty: item.qty,
              price: item.price,
              subtotal: item.price * item.qty
            }
          });
        }
      }

      return sale;
    });

    res.json({ success: true, message: 'Transaksi berhasil disimpan!', data: result });

  } catch (error) {
    console.error("Detail Error Transaksi:", error);
    res.status(400).json({ 
      success: false, 
      message: 'Checkout Gagal. Mungkin ada masalah stok pada kue satuan yang Anda pilih.', 
      error: error.message 
    });
  }
});

// [MODUL PENGELUARAN]
// 3. Endpoint untuk mencatat biaya operasional (listrik, kurir, kotak kue).
app.post('/api/expenses', async (req, res) => {
  const { category, description, amount } = req.body;
  try {
    const expense = await prisma.expense.create({
      data: { category, description, amount: parseInt(amount) }
    });
    res.json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mencatat pengeluaran di server' });
  }
});

// [MODUL LAPORAN & ANALITIK]
// 4. Endpoint Laporan Global (Pendapatan, Pengeluaran, Laba)
app.get('/api/reports', async (req, res) => {
  const { period, start, end } = req.query; // Menangkap parameter tanggal dari frontend
  let dateFilter = {};

  // Logika Filter Tanggal (Hari Ini, Bulan Ini, atau Custom)
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
    const sales = await prisma.sale.findMany({ where: dateFilter });
    const expenses = await prisma.expense.findMany({ where: dateFilter });
    
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    res.json({
      success: true,
      data: {
        revenue: totalRevenue,
        expenses: totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        transactions: sales.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat laporan' });
  }
});

// 5. Endpoint untuk Laporan Detail per Item (PEMISAHAN BIJIAN & KARDUS)
app.get('/api/reports/items', async (req, res) => {
  const { period, start, end } = req.query;
  let dateFilter = {};

  // Logika Filter Tanggal yang sama untuk detail item
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
    const saleItems = await prisma.saleItem.findMany({
      where: { sale: dateFilter }, // Cari transaksi berdasarkan tanggal induknya
      include: {
        product: { include: { supplier: true } },
        package: { include: { items: { include: { product: { include: { supplier: true } } } } } }
      }
    });

    const itemSummary = {};

    const catatBarang = (produk, qtyTerjual, omset, label) => {
      const key = produk.id + '_' + label;
      if (!itemSummary[key]) {
        itemSummary[key] = {
          id: key, name: produk.name + (label === 'Bijian' ? '' : ` (${label})`),
          supplier: produk.supplier.name, qtySold: 0, totalSales: 0
        };
      }
      itemSummary[key].qtySold += qtyTerjual;
      itemSummary[key].totalSales += omset;
    };

    saleItems.forEach(item => {
      if (item.product) {
        const isCustom = item.price !== item.product.sellPrice;
        const label = isCustom ? 'Paket Snack Box' : 'Bijian';
        catatBarang(item.product, item.qty, item.subtotal, label);
      } else if (item.package) {
        item.package.items.forEach(isi => {
          const qtyTerjual = isi.qty * item.qty;
          const omset = isi.product.sellPrice * qtyTerjual; 
          catatBarang(isi.product, qtyTerjual, omset, 'Paket Permanen');
        });
      }
    });

    const resultList = Object.values(itemSummary).sort((a, b) => b.qtySold - a.qtySold);
    res.json({ success: true, data: resultList });
  } catch (error) {
    console.error("Gagal memuat detail item:", error);
    res.status(500).json({ success: false, message: 'Gagal memuat detail item terjual' });
  }
});

// 6. Endpoint untuk Update Stok Produk (Penerimaan Barang Pagi)
app.put('/api/products/:id/stock', async (req, res) => {
  const productId = parseInt(req.params.id);
  const { newStock } = req.body; // Menangkap jumlah stok baru yang diketik

  try {
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: { stock: parseInt(newStock) }
    });
    res.json({ success: true, data: updatedProduct });
  } catch (error) {
    console.error("Gagal update stok:", error);
    res.status(500).json({ success: false, message: 'Gagal mengubah stok di database' });
  }
});

// --- HALAMAN UTAMA SERVER ---
app.get('/', (req, res) => {
  res.send('<h1>Server POS Kukita Berjalan Normal! 🚀</h1><p>Backend API siap digunakan oleh aplikasi kasir.</p>');
});

// --- ENDPOINT LAPORAN PENJUALAN ---
app.get('/api/sales', async (req, res) => {
  try {
    const sales = await prisma.sale.findMany({
      orderBy: { createdAt: 'desc' }, // Urutkan dari transaksi terbaru
      include: {
        items: {
          include: {
            product: true,
            package: true
          }
        }
      }
    });
    res.json(sales);
  } catch (error) {
    console.error('Error mengambil data penjualan:', error);
    res.status(500).json({ error: 'Gagal mengambil data penjualan' });
  }
});

// --- MENJALANKAN SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 POS Kukita Backend (Dapur Utama) mendengarkan di: http://localhost:${PORT}`);
});