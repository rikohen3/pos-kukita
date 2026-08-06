import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Hapus data lama agar bersih
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.packageItem.deleteMany();
  await prisma.package.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.category.deleteMany();

  console.log('Brankas lama berhasil dibersihkan.');

  // 2. Buat Kategori
  const catKue = await prisma.category.create({ data: { name: 'Kue Basah & Jajanan' } });
  const catCake = await prisma.category.create({ data: { name: 'Cake & Roti' } });
  const catPuding = await prisma.category.create({ data: { name: 'Puding & Dessert' } });
  const catMinum = await prisma.category.create({ data: { name: 'Minuman' } });
  const catLain = await prisma.category.create({ data: { name: 'Perlengkapan' } });

  // 3. Buat Supplier
  const supYanti = await prisma.supplier.create({ data: { name: 'Mba Yanti', phone: '-' } });
  const supMulti = await prisma.supplier.create({ data: { name: 'Multi', phone: '-' } });
  const supFinka = await prisma.supplier.create({ data: { name: 'Finka', phone: '-' } });
  const supNur = await prisma.supplier.create({ data: { name: 'Mba Nur', phone: '-' } });
  const supRiska = await prisma.supplier.create({ data: { name: 'Riska', phone: '-' } });
  const supSusi = await prisma.supplier.create({ data: { name: 'Bu Susi', phone: '-' } });
  const supAir = await prisma.supplier.create({ data: { name: 'Agen Narmada', phone: '-' } });
  const supToko = await prisma.supplier.create({ data: { name: 'Toko Kukita', phone: '-' } }); // Khusus box kosong

  // 4. Buat Produk Lengkap
  const products = [
    // --- 1. Mba Yanti ---
    { name: 'Klapetart', categoryId: catKue.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Lumpur Surga', categoryId: catKue.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Roll Cake Coklat', categoryId: catCake.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Roll Cake Velvet', categoryId: catCake.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Cake Puding', categoryId: catPuding.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Lapis Surabaya', categoryId: catCake.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Sarang Semut', categoryId: catCake.id, supplierId: supYanti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- 2. Multi ---
    { name: 'Puding Oreo', categoryId: catPuding.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Puding Lumut', categoryId: catPuding.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Puding Mangga Susu', categoryId: catPuding.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Siomay Pangsit', categoryId: catKue.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Muffin Coklat', categoryId: catCake.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Muffin Keju', categoryId: catCake.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Pukis', categoryId: catKue.id, supplierId: supMulti.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- 3. Finka ---
    { name: 'Risoles', categoryId: catKue.id, supplierId: supFinka.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Roti Sosis', categoryId: catCake.id, supplierId: supFinka.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Roti Pisang Coklat', categoryId: catCake.id, supplierId: supFinka.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Roti Keju', categoryId: catCake.id, supplierId: supFinka.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- 4. Mba Nur ---
    { name: 'Sosis Solo', categoryId: catKue.id, supplierId: supNur.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- 5. Riska ---
    { name: 'Cake Tape', categoryId: catCake.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Cake Marmer', categoryId: catCake.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Pastel', categoryId: catKue.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Puding Coklat', categoryId: catPuding.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Puding Karamel', categoryId: catPuding.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Puding Degan', categoryId: catPuding.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Sarang Semut', categoryId: catCake.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Bika Ambon', categoryId: catKue.id, supplierId: supRiska.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- 6. Bu Susi ---
    { name: 'Onde-onde', categoryId: catKue.id, supplierId: supSusi.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },
    { name: 'Lemper', categoryId: catKue.id, supplierId: supSusi.id, buyPrice: 3000, sellPrice: 4000, stock: 20 },

    // --- Tambahan ---
    { name: 'Air Mineral Narmada (Gelas)', categoryId: catMinum.id, supplierId: supAir.id, buyPrice: 800, sellPrice: 1000, stock: 100 },
    { name: 'Box Snack Kosong', categoryId: catLain.id, supplierId: supToko.id, buyPrice: 500, sellPrice: 1000, stock: 100 }
  ];

  for (const p of products) {
    await prisma.product.create({ data: p });
  }

  console.log('Data Produk Asli berhasil disuntikkan!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });