const SERVER_URL = 'https://pos-kukita.vercel.app';

function posApp() {
    return {
        activeCashier: null, loginPin: '', cashiersList: [], newCashierName: '', newCashierPin: '',
        currentTab: 'pos', categories: ['Semua'], selectedCategory: 'Semua', searchQuery: '', masterSearchQuery: '', cart: [], products: [], 
        showMobileCart: false, showPaymentModal: false, paymentStep: 'input', paymentMethod: 'Tunai', 
        cashReceived: '', mixCash: '', isProcessing: false, isLoading: true, lastTx: null, isCustomPackage: false, 
        currentTime: new Date().toLocaleString('id-ID'),
        
        cleanNotes(s) { return s ? s.replace(/\[RTR:.*?\]/g, '').trim() : ''; },

        isPaket(items) { 
            if (!items) return false;
            return items.some(i => i.price % 100 !== 0); 
        },
        
        expCat: 'Pembayaran Vendor (Kue / Stok)', expDesc: '', expAmount: '', expMethod: 'Tunai',
        reportData: { revenue: 0, revenueCash: 0, revenueQris: 0, piutang: 0, grossProfit: 0, expenses: 0, expCash: 0, expTransfer: 0, transactions: 0, netProfit: 0, salesHistory: [], stockHistory: [], vendorHistory: [] }, 
        customerName: '', itemReports: [], reportPeriod: 'today', startDate: '', endDate: '', reportSubTab: 'ringkasan',
        oldPin: '', newPin: '', isPrintingReceipt: false, isPrintingCatalog: false,
        showAddProductModal: false, options: { categories: [], suppliers: [] }, 
        newProduct: { name: '', categoryId: '', supplierId: '', buyPrice: '', sellPrice: '', stock: '', image: '' },
        
        showDetailModal: false, selectedTx: null, selectedTxCart: [],
        saldoAwalLaci: localStorage.getItem('saldo_laci') || 0,
        packageTotal: 0, productSortBy: 'name_asc', poList: [], piutangList: [], showPoModal: false,
        poForm: { name: '', phone: '', pickupDate: '', shippingCost: '', dp: '', paymentMethod: 'Tunai', notes: '' },

        restockSupplierId: '', restockSupplierName: '', restockCart: [], restockDiscount: '', restockMethod: 'Tunai', restockNotes: '', isPrintingVendor: false, lastVendorTx: null,
        restockStockAddedPagi: false, pendingDrafts: [],

        async init() {
            setTimeout(() => { lucide.createIcons(); }, 100);
            setInterval(() => { this.currentTime = new Date().toLocaleString('id-ID'); }, 1000);
            this.$watch('currentTab', () => { setTimeout(() => { lucide.createIcons(); }, 50); });
            this.$watch('showMobileCart', () => { setTimeout(() => { lucide.createIcons(); }, 10); }); 
            await this.fetchCashiers(); 
            await this.fetchCatalog();
        },

        hasDraft(supId) { return localStorage.getItem('draft_restock_' + supId) !== null; },
        
        updatePendingDrafts() {
            if (!this.options || !this.options.suppliers) return;
            this.pendingDrafts = this.options.suppliers.filter(sup => {
                return localStorage.getItem('draft_restock_' + sup.id) !== null;
            });
        },

        viewTransactionDetail(tx) {
            this.selectedTx = tx;
            let reconstructedCart = [];
            if (tx.items) {
                const parts = tx.items.split(', ');
                reconstructedCart = parts.map(p => {
                    let name = p.trim();
                    let qty = 1;
                    const match = p.match(/(.*) \(x(\d+)\)/);
                    if (match) { name = match[1].trim(); qty = parseInt(match[2]); }
                    let foundProduct = this.products.find(prod => prod.name === name);
                    let price = foundProduct ? foundProduct.price : 0;
                    return { name: name, qty: qty, price: price };
                });
            }
            this.selectedTxCart = reconstructedCart;
            this.showDetailModal = true;
            setTimeout(() => { lucide.createIcons(); }, 10);
        },

        isStockOld(product) {
            if(!product.lastRestock || product.stock <= 0) return false;
            const hours = (new Date() - new Date(product.lastRestock)) / (1000 * 60 * 60);
            const cat = (product.category || '').toLowerCase();
            let limit = 24; 
            if (cat.includes('minum') || cat.includes('cair')) limit = 24 * 30; 
            else if (cat.includes('kering') || cat.includes('snack') || cat.includes('keripik')) limit = 24 * 14; 
            return hours > limit;
        },
        
        formatDateShort(d) {
            if (!d) return '-';
            const date = new Date(d);
            return date.toLocaleDateString('id-ID', {day: 'numeric', month: 'short'}) + ' ' + date.toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
        },
        
        resetStockAge(id, name) {
            if(!confirm(`Perbarui umur kue ${name}?\n\nTanggal masuk kue ini akan di-reset menjadi hari ini sehingga peringatan kadaluarsa hilang.`)) return;
            localStorage.setItem('last_restock_date_' + id, new Date().toISOString());
            this.fetchCatalog();
        },

        restorePrices() {
            if(this.isCustomPackage) {
                this.isCustomPackage = false;
                this.packageTotal = 0;
                this.customerName = '';
                this.cart.forEach(item => {
                    const prod = this.products.find(p => p.id === item.id && p.type === item.type);
                    if(prod) item.price = prod.price;
                });
            }
        },

        async editSaldoAwal() {
            const sandi = prompt("🔒 SET SALDO AWAL\nMasukkan PIN Admin untuk mengubah modal laci:"); 
            if (!sandi) return;
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ Akses ditolak! PIN Salah.");
                const inputStr = prompt("💰 MASUKKAN SALDO AWAL LACI\nKetik jumlah uang kas di laci pagi ini:", this.saldoAwalLaci);
                if (inputStr === null || inputStr.trim() === "") return;
                const nominal = parseInt(inputStr);
                if (isNaN(nominal) || nominal < 0) return alert('Nominal tidak valid!');
                this.saldoAwalLaci = nominal;
                localStorage.setItem('saldo_laci', this.saldoAwalLaci);
                alert('✅ Saldo Awal berhasil disimpan!');
            } catch (e) { alert('Gagal memverifikasi PIN.'); }
        },

        async fetchCashiers() { 
            try { 
                const res = await fetch(`${SERVER_URL}/api/cashiers`); 
                const data = await res.json(); 
                if(data.success) this.cashiersList = data.data; 
            } catch(e){} 
        },
        
        async login() {
            if(!this.loginPin) return;
            if (this.loginPin === '030388' || this.loginPin === '100515' || this.loginPin === '818283') { 
                this.activeCashier = 'Admin Toko'; this.loginPin = ''; setTimeout(() => lucide.createIcons(), 50); 
                await this.fetchCashiers(); await this.fetchCatalog(); return; 
            }
            const found = this.cashiersList.find(c => c.pin === this.loginPin);
            if (found) { 
                this.activeCashier = found.name; this.loginPin = ''; setTimeout(() => lucide.createIcons(), 50); return; 
            }
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: this.loginPin }) });
                if ((await resPin.json()).success) { 
                    this.activeCashier = 'Admin Toko'; this.loginPin = ''; setTimeout(() => lucide.createIcons(), 50); return; 
                }
            } catch(e){}
            alert('❌ Akses Ditolak!'); this.loginPin = '';
        },
        
        logout() { this.activeCashier = null; this.currentTab = 'pos'; },
        
        async fetchCatalog() {
            this.isLoading = true;
            try {
                const res = await fetch(`${SERVER_URL}/api/catalog`); const result = await res.json();
                if(result.success) {
                    const prodList = result.data.products.map(p => {
                        const lastRestock = localStorage.getItem('last_restock_date_' + p.id);
                        return { 
                            id: p.id, name: p.name, category: p.category.name, supplier: p.supplier.name, supplierId: p.supplier.id, 
                            price: p.sellPrice, buyPrice: p.buyPrice, stock: p.stock, image: p.image || null, 
                            icon: p.category.name.includes('Minuman') ? '🍹' : '🍩', type: 'product',
                            lastRestock: lastRestock
                        };
                    });
                    const pkgList = result.data.packages.map(p => ({ id: p.id, name: p.name, category: 'Paket', supplier: 'Kombinasi Supplier', supplierId: null, price: p.sellPrice, stock: 999, image: p.image || null, icon: '🎁', type: 'package' }));
                    this.products = [...prodList, ...pkgList]; 
                    this.categories = ['Semua', ...Array.from(new Set(this.products.map(p => p.category)))];
                }
            } catch (e) {} finally { this.isLoading = false; setTimeout(() => { lucide.createIcons(); }, 10); }
        },

        get filteredProducts() { 
            return this.products.filter(p => { 
                const matchCat = this.selectedCategory === 'Semua' || p.category === this.selectedCategory; 
                const matchSearch = p.name.toLowerCase().includes(this.searchQuery.toLowerCase()); 
                return matchCat && matchSearch; 
            }); 
        },
        
        get filteredMasterProducts() { 
            let filtered = this.products.filter(p => p.name.toLowerCase().includes(this.masterSearchQuery.toLowerCase())); 
            if (this.productSortBy === 'stock_desc') { 
                filtered.sort((a, b) => (b.stock || 0) - (a.stock || 0)); 
            } else if (this.productSortBy === 'stock_asc') { 
                filtered.sort((a, b) => (a.stock || 0) - (b.stock || 0)); 
            } else { 
                filtered.sort((a, b) => a.name.localeCompare(b.name)); 
            }
            return filtered;
        },
        
        addToCart(product) { 
            this.restorePrices(); 
            const itemToAdd = { ...product, cartItemId: Date.now() + Math.random(), qty: 1 }; 
            const existing = this.cart.find(item => item.id === product.id && item.type === product.type && item.price === product.price); 
            if (existing) { existing.qty++; } else { this.cart.unshift(itemToAdd); } 
        },
        
        increaseQty(index) { this.restorePrices(); this.cart[index].qty++; },
        decreaseQty(index) { this.restorePrices(); if (this.cart[index].qty > 1) this.cart[index].qty--; else this.removeFromCart(index); },
        removeFromCart(index) { this.restorePrices(); this.cart.splice(index, 1); },
        validateQty(index) { this.restorePrices(); let val = parseInt(this.cart[index].qty); if (isNaN(val) || val < 1) val = 1; this.cart[index].qty = val; },

        get total() { return this.isCustomPackage ? this.packageTotal : this.cart.reduce((sum, item) => sum + (item.price * item.qty), 0); },
        get totalQty() { return this.cart.reduce((sum, item) => sum + item.qty, 0); },
        get change() { return parseFloat(this.cashReceived || 0) - this.total; },
        formatRupiah(number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(number); },
        
        setCustomPrice() { 
            if (this.cart.length === 0) return alert('Keranjang kosong!'); 
            const qtyStr = prompt('📦 SET HARGA PAKET\nJumlah Kotak?', '1'); if (!qtyStr) return; const qtyBox = parseInt(qtyStr); if (isNaN(qtyBox) || qtyBox <= 0) return alert('Tidak valid!');
            const priceStr = prompt(`Harga Per Kotak?`, '0'); if (!priceStr) return; const pricePerBox = parseFloat(priceStr); if (isNaN(pricePerBox) || pricePerBox < 0) return alert('Tidak valid!');
            const newTotal = qtyBox * pricePerBox;
            const inputNama = prompt(`Nama Pemesan:`, ''); let namaPemesan = inputNama ? inputNama.trim() + " - " : "Pesanan Umum - ";
            this.customerName = `${namaPemesan}${qtyBox} Kotak`; 
            this.isCustomPackage = true; 
            this.packageTotal = newTotal; 
            
            let originalTotal = 0; this.cart.forEach(item => { const prod = this.products.find(p => p.id === item.id && p.type === item.type); originalTotal += ((prod ? prod.price : item.price) * item.qty); });
            if (originalTotal > 0) {
                const ratio = newTotal / originalTotal; let runningTotal = 0; 
                for (let i = 0; i < this.cart.length; i++) { 
                    const prod = this.products.find(p => p.id === this.cart[i].id && p.type === this.cart[i].type); const normalPrice = prod ? prod.price : this.cart[i].price;
                    if (i === this.cart.length - 1) { this.cart[i].price = Math.round((newTotal - runningTotal) / this.cart[i].qty); } 
                    else { const newPrice = Math.round(normalPrice * ratio); this.cart[i].price = newPrice; runningTotal += (newPrice * this.cart[i].qty); } 
                } 
            }
            alert(`✅ SET BERHASIL! Silakan klik BAYAR ATAU SIMPAN PO.`);
        },
        
        openPayment() { 
            let stokKurang = false; 
            let namaBarangKurang = '';
            
            for (let item of this.cart) {
                if (item.type === 'product') {
                    const prod = this.products.find(p => p.id === item.id && p.type === item.type);
                    if (prod && item.qty > Number(prod.stock || 0)) { 
                        stokKurang = true; 
                        namaBarangKurang = item.name; 
                        break; 
                    }
                }
            }
            
            if (stokKurang) { 
                return alert(`❌ STOK TIDAK CUKUP!\n\nSisa stok fisik '${namaBarangKurang}' di etalase tidak mencukupi untuk dijual hari ini.\n\n💡 Jika ini pesanan untuk besok/lusa, silakan gunakan tombol "Simpan sbg PO".`); 
            }
            
            this.cashReceived = ''; 
            this.mixCash = ''; 
            this.paymentMethod = 'Tunai'; 
            this.paymentStep = 'input'; 
            this.showPaymentModal = true; 
            
            setTimeout(() => { lucide.createIcons(); }, 10); 
        },
        
        closePayment() { 
            if (this.paymentStep === 'success') { 
                this.resetCart(); 
            } else { 
                this.showPaymentModal = false; 
            } 
        },
        
        async processTransaction() {
            let totalBelanja = this.total; let qtyBelanja = this.totalQty; let uangMasuk = 0;
            if (this.paymentMethod === 'Tunai') { uangMasuk = parseFloat(this.cashReceived) || totalBelanja; } 
            else if (this.paymentMethod === 'Mix') { uangMasuk = parseFloat(this.mixCash) || 0; if (uangMasuk <= 0 || uangMasuk >= totalBelanja) return alert('❌ Nominal Tunai Mix tidak valid!'); } 
            else if (this.paymentMethod === 'Piutang') { if (!this.customerName) return alert('❌ Nama Pemesan WAJIB diisi untuk kasbon!'); uangMasuk = 0; }

            this.isProcessing = true;
            let uangKembali = this.paymentMethod === 'Tunai' ? (uangMasuk - totalBelanja) : 0;
            let keranjangFix = JSON.parse(JSON.stringify(this.cart));
            let mappedCart = this.cart.map(item => ({ id: item.id, type: item.type, qty: item.qty, price: item.price }));
            let finalName = this.customerName ? `${this.customerName} [Kasir: ${this.activeCashier}]` : `[Kasir: ${this.activeCashier}]`;

            const payload = { cart: mappedCart, paymentMethod: this.paymentMethod, cashReceived: uangMasuk, totalAmount: totalBelanja, isPackage: this.isCustomPackage, customerName: finalName };
            
            try {
                const res = await fetch(`${SERVER_URL}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const result = await res.json();
                if (result.success) { 
                    this.lastTx = { invoice: result.data.invoice, date: new Date().toLocaleString('id-ID'), cart: keranjangFix, total: totalBelanja, cash: uangMasuk, change: uangKembali, isPackage: this.isCustomPackage, method: this.paymentMethod, totalQty: qtyBelanja }; 
                    this.paymentStep = 'success'; this.fetchCatalog();
                } else alert('Gagal.');
            } catch (e) { alert('Error.'); } finally { this.isProcessing = false; }
        },

        openPoForm() { this.poForm = { name: this.customerName || '', phone: '', pickupDate: '', shippingCost: '', dp: '', paymentMethod: 'Tunai', notes: '' }; this.showPoModal = true; setTimeout(() => { lucide.createIcons(); }, 10); },
        
        async fetchOrders() { try { const res = await fetch(`${SERVER_URL}/api/orders`); const data = await res.json(); if (data.success) { this.poList = data.data; setTimeout(() => { lucide.createIcons(); }, 10); } } catch (error) {} },
        
        async fetchPiutang() { try { const res = await fetch(`${SERVER_URL}/api/piutang`); const result = await res.json(); if(result.success) { this.piutangList = result.data; setTimeout(() => { lucide.createIcons(); }, 10); } } catch(e) {} },
        
        isPast(dateString) { return new Date(dateString) < new Date(); },

        async submitPo() {
            if (!this.poForm.name || !this.poForm.pickupDate) return alert('Nama dan Waktu Pengambilan Wajib Diisi!');
            this.isProcessing = true;
            let mappedCart = this.cart.map(item => ({ id: item.id, type: item.type, qty: item.qty, price: item.price }));
            const payload = { customerName: this.poForm.name, customerPhone: this.poForm.phone, pickupDate: this.poForm.pickupDate, shippingCost: this.poForm.shippingCost, downPayment: this.poForm.dp, paymentMethod: this.poForm.paymentMethod, notes: this.poForm.notes, cashierName: this.activeCashier, cart: mappedCart, totalAmount: this.total };

            try {
                const res = await fetch(`${SERVER_URL}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const result = await res.json();
                if (result.success) { alert('✅ BUKU PESANAN TERSIMPAN!\nStok barang belum dipotong. Anda bisa mengeceknya di menu Buku Pesanan.'); this.showPoModal = false; this.resetCart(); this.fetchOrders(); } else { alert('Gagal menyimpan PO.'); }
            } catch (e) {} finally { this.isProcessing = false; }
        },

        async completeOrder(order) {
            const remaining = (order.totalAmount + order.shippingCost) - order.downPayment;
            let method = order.paymentMethod || 'Tunai';

            if (remaining > 0) {
                const inputMethod = prompt(`💰 PELUNASAN KUE\n\nPesanan ini memiliki sisa tagihan: Rp ${new Intl.NumberFormat('id-ID').format(remaining)}\n\nSisa tagihan ini diselesaikan menggunakan metode apa?\nKetik "1" untuk TUNAI\nKetik "2" untuk QRIS / Transfer\nKetik "3" untuk KASBON / PIUTANG INSTANSI`, '1');
                if (inputMethod === null) return;
                if (inputMethod === '3') { method = 'Piutang'; } else { method = inputMethod === '2' ? 'QRIS' : 'Tunai'; }
            }

            if (!confirm(`⚠️ Selesaikan pesanan ${order.customerName}?\n\n- Stok fisik kue akan otomatis dipotong hari ini.\n- Jika ada sisa tagihan/piutang, akan masuk ke laporan hari ini.`)) return;

            this.isProcessing = true;
            try {
                const res = await fetch(`${SERVER_URL}/api/orders/${order.id}/complete`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethod: method }) });
                const result = await res.json();
                if (result.success) {
                    this.lastTx = { invoice: `LUNAS-${order.invoice} (${order.customerName})`, date: new Date().toLocaleString('id-ID'), cart: order.items.map(i => ({ name: i.product ? i.product.name : i.package.name, qty: i.qty, price: i.price })), total: remaining, cash: method === 'Tunai' ? remaining : 0, change: 0, isPackage: false, method: method, totalQty: order.items.reduce((sum, i) => sum + i.qty, 0) };
                    this.paymentStep = 'success'; this.showPaymentModal = true; this.fetchOrders(); this.fetchCatalog();
                } else alert('Gagal memproses pesanan.');
            } catch (e) {} finally { this.isProcessing = false; }
        },

        async deleteOrder(id, name) {
            const sandi = prompt(`🔒 HAPUS PESANAN\n\nMasukkan PIN Admin Anda untuk menghapus pesanan atas nama ${name}:`); if (!sandi) return;
            const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
            if (!(await resPin.json()).success) return alert("❌ Akses ditolak! Password salah.");
            if (!confirm('Yakin ingin membatalkan dan menghapus pesanan ini dari buku?')) return;
            try {
                const res = await fetch(`${SERVER_URL}/api/orders/${id}`, { method: 'DELETE' });
                if ((await res.json()).success) { alert('Pesanan dibatalkan.'); this.fetchOrders(); }
            } catch (e) {}
        },

        resetCart() { this.cart = []; this.isCustomPackage = false; this.packageTotal = 0; this.customerName = ''; this.showPaymentModal = false; this.paymentStep = 'input'; this.showMobileCart = false; },

        printPO(order) {
            let mappedCart = order.items.map(i => ({ name: i.product ? i.product.name : i.package.name, qty: i.qty, price: i.price }));
            this.lastTx = {
                invoice: order.invoice,
                date: new Date(order.pickupDate).toLocaleString('id-ID'),
                cart: mappedCart,
                total: order.totalAmount + order.shippingCost,
                cash: order.downPayment, 
                change: 0,
                isPackage: this.isPaket(mappedCart),
                method: order.paymentMethod || 'Tunai',
                totalQty: order.items.reduce((sum, i) => sum + i.qty, 0),
                isPO: true, 
                shippingCost: order.shippingCost,
                downPayment: order.downPayment,
                remaining: (order.totalAmount + order.shippingCost) - order.downPayment
            };
            this.printReceipt();
        },

        loadDraftSupplier() {
            if(this.restockSupplierId) {
                const selectedSup = this.options.suppliers.find(s => s.id == this.restockSupplierId);
                this.restockSupplierName = selectedSup ? selectedSup.name : '';
            } else {
                this.restockSupplierName = '';
            }

            this.restockCart = []; this.restockDiscount = ''; this.restockNotes = '';
            this.restockStockAddedPagi = false;

            if(!this.restockSupplierId) return;
            const savedDraft = localStorage.getItem(`draft_restock_${this.restockSupplierId}`);
            if(savedDraft) {
                try {
                    const parsed = JSON.parse(savedDraft);
                    this.restockCart = parsed.cart || [];
                    this.restockDiscount = parsed.discount || '';
                    this.restockMethod = parsed.method || 'Tunai';
                    this.restockNotes = parsed.notes || '';
                    if (this.restockCart.some(i => i.alreadyInStock)) {
                        this.restockStockAddedPagi = true;
                    }
                } catch(e) {}
            }
        },
        
        saveDraftLocally() {
            if(!this.restockSupplierId) return;
            if(this.restockCart.length === 0 && !this.restockDiscount && !this.restockNotes) {
                localStorage.removeItem(`draft_restock_${this.restockSupplierId}`);
            } else {
                const draftData = { cart: this.restockCart, discount: this.restockDiscount, method: this.restockMethod, notes: this.restockNotes };
                localStorage.setItem(`draft_restock_${this.restockSupplierId}`, JSON.stringify(draftData));
            }
            this.updatePendingDrafts();
        },

        addToRestockCart(product) { 
            if(!product.buyPrice || product.buyPrice <= 0) return alert('❌ Harga Modal produk ini masih 0 atau belum diisi. Silakan edit terlebih dahulu di menu Master Produk!');
            const existing = this.restockCart.find(item => item.id === product.id && !item.alreadyInStock); 
            if (existing) { existing.qty++; } else { this.restockCart.unshift({ ...product, qty: 1, returQty: 0, alreadyInStock: false }); } 
            this.saveDraftLocally();
        },
        
        updateRestockQty(index, diff) {
            if(this.restockCart[index].alreadyInStock) return alert('Barang ini sudah masuk ke stok fisik pagi. Jumlahnya tidak bisa dikurangi dari draft.');
            if(diff < 0 && this.restockCart[index].qty <= 1) return;
            this.restockCart[index].qty += diff;
            this.saveDraftLocally();
        },
        
        setRestockQty(index, val) {
            if(this.restockCart[index].alreadyInStock) return alert('Barang ini sudah masuk ke stok fisik pagi.');
            let num = parseInt(val); if(isNaN(num) || num < 1) num = 1;
            this.restockCart[index].qty = num;
            this.saveDraftLocally();
        },

        updateReturQty(index, diff) {
            let item = this.restockCart[index];
            if(!item.returQty) item.returQty = 0;
            let newVal = item.returQty + diff;
            if(newVal < 0) newVal = 0;
            if(newVal > item.qty) return alert('Jumlah retur tidak boleh lebih besar dari jumlah barang masuk!');
            item.returQty = newVal;
            this.saveDraftLocally();
        },

        validateReturQty(index) {
            let item = this.restockCart[index];
            let val = parseInt(item.returQty);
            if(isNaN(val) || val < 0) val = 0;
            if(val > item.qty) { alert('Jumlah retur tidak boleh lebih besar dari jumlah barang masuk!'); val = item.qty; }
            item.returQty = val;
            this.saveDraftLocally();
        },

        async removeRestockItem(index) {
            if(this.isProcessing) return;
            let item = this.restockCart[index];
            
            if(item.alreadyInStock) {
                const sandi = prompt(`🔒 HAPUS DARI DRAFT\n\nBarang ini sudah masuk etalase pagi tadi. Masukkan PIN Admin untuk menghapusnya dari nota sekaligus menarik kembali stok ${item.name} (${item.qty} pcs):`);
                if (!sandi) return;
                
                this.isProcessing = true;
                try {
                    const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                    if (!(await resPin.json()).success) {
                        this.isProcessing = false;
                        return alert("❌ Akses ditolak! PIN Salah.");
                    }
                } catch(e) { this.isProcessing = false; return alert("Gagal verifikasi PIN."); }

                const prod = this.products.find(p => p.id === item.id);
                if (prod) {
                    const newStock = prod.stock - item.qty;
                    try {
                        await fetch(`${SERVER_URL}/api/products/${item.id}/stock-v2`, {
                            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStock: newStock >= 0 ? newStock : 0 })
                        });
                    } catch(e) {}
                }
                alert(`✅ Barang ${item.name} batal diterima. Stok etalase telah ditarik kembali.`);
                this.isProcessing = false;
            }
            
            this.restockCart.splice(index, 1);
            this.saveDraftLocally();
            this.fetchCatalog(); 
        },

        get restockTotal() { 
            return this.restockCart.reduce((sum, i) => sum + ((i.buyPrice || 0) * (i.qty - (i.returQty || 0))), 0); 
        },
        get restockGrandTotal() { return this.restockTotal - (parseInt(this.restockDiscount) || 0); },
        
        async submitRestock(isPrintingMalam) {
            if(this.restockCart.length === 0) return alert('Keranjang penerimaan kosong!');
            if(!this.restockSupplierId) return alert('Silakan pilih Supplier/Vendor terlebih dahulu!');
            
            const selectedSup = this.options.suppliers.find(s => s.id == this.restockSupplierId);
            this.restockSupplierName = selectedSup ? selectedSup.name : 'Vendor Tidak Diketahui';

            const pesan = isPrintingMalam ? 
                "🔒 TUTUP NOTA MALAM\n\nMasukkan PIN Admin untuk menyetujui Pembayaran ke Vendor & Cetak Nota:" : 
                "🔒 SIMPAN DRAFT PAGI/SIANG\n\nMasukkan PIN Admin untuk menyetujui Penambahan Stok tanpa mengeluarkan uang:";
            
            const sandi = prompt(pesan); 
            if (!sandi) return;
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ PIN Salah.");
            } catch(e) { return alert("Gagal verifikasi PIN."); }

            this.isProcessing = true;
            try {
                const hasNewItems = this.restockCart.some(item => !item.alreadyInStock);
                
                if (!isPrintingMalam) {
                    if (!hasNewItems) {
                        this.isProcessing = false;
                        return alert('Tidak ada barang baru untuk ditambahkan ke stok pagi. Silakan klik Tutup Nota Malam jika ingin membayar.');
                    }
                    
                    for (let item of this.restockCart) {
                        if (!item.alreadyInStock) {
                            const prod = this.products.find(p => p.id === item.id);
                            if (prod) {
                                // PERBAIKAN STOK: Tambah ke etalase hanya stok yang SUDAH dikurangi retur
                                const jumlahBersih = item.qty - (item.returQty || 0);
                                const newStock = prod.stock + jumlahBersih;
                                await fetch(`${SERVER_URL}/api/products/${item.id}/stock-v2`, { 
                                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStock }) 
                                });
                                item.alreadyInStock = true;
                                localStorage.setItem('last_restock_date_' + item.id, new Date().toISOString());
                            }
                        }
                    }
                    this.restockStockAddedPagi = true;
                    this.saveDraftLocally();
                    alert('✅ STOK BERTAMBAH!\nBarang sudah masuk etalase aplikasi (sudah dikurangi retur). Tersimpan di Draft untuk dibayar nanti malam.');
                    
                    this.restockSupplierId = '';
                    this.restockSupplierName = '';
                    this.restockCart = [];
                    this.restockDiscount = '';
                    this.restockNotes = '';
                    this.restockStockAddedPagi = false;
                    
                    this.fetchCatalog();
                    this.isProcessing = false;
                    return;
                }

                if (isPrintingMalam) {
                    // PERBAIKAN SERVER: Kirim data qty utuh dan retur utuh agar tidak terpotong di cetakan
                    const payloadItems = this.restockCart.map(item => ({
                        ...item,
                        qty: item.qty,
                        returQty: item.returQty || 0
                    })).filter(item => item.qty > 0);

                    let stokAsli = {};
                    for (let item of this.restockCart) {
                        if (this.restockStockAddedPagi || item.alreadyInStock) {
                            const prod = this.products.find(p => p.id === item.id);
                            if (prod) {
                                stokAsli[item.id] = prod.stock; 
                            }
                        }
                    }

                    const payload = { supplierId: this.restockSupplierId, supplierName: this.restockSupplierName, items: payloadItems, discount: this.restockDiscount, paymentMethod: this.restockMethod, notes: this.cleanNotes(this.restockNotes), printNow: true };
                    const res = await fetch(`${SERVER_URL}/api/restock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    const result = await res.json();
                    
                    if(result.success) {
                        for (let idKue in stokAsli) {
                            try {
                                await fetch(`${SERVER_URL}/api/products/${idKue}/stock-v2`, { 
                                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStock: stokAsli[idKue] }) 
                                });
                            } catch(e) {}
                        }
                        
                        for (let item of this.restockCart) {
                            if (!item.alreadyInStock) {
                                localStorage.setItem('last_restock_date_' + item.id, new Date().toISOString());
                            }
                        }

                        const savedCartForReceipt = JSON.parse(JSON.stringify(this.restockCart));
                        this.lastVendorTx = { invoice: result.data.invoice, date: new Date().toLocaleString('id-ID'), supplier: this.restockSupplierName, cart: savedCartForReceipt, total: this.restockTotal, discount: parseInt(this.restockDiscount) || 0, grandTotal: result.data.grandTotal, method: this.restockMethod, notes: this.cleanNotes(this.restockNotes) };
                        alert(`✅ NOTA LUNAS DITUTUP!\nPengeluaran kas sudah tercatat otomatis.`);
                        
                        localStorage.removeItem(`draft_restock_${this.restockSupplierId}`);
                        
                        this.restockSupplierId = '';
                        this.restockSupplierName = '';
                        this.restockCart = [];
                        this.restockDiscount = '';
                        this.restockNotes = '';
                        this.restockStockAddedPagi = false;
                        this.updatePendingDrafts(); 
                        
                        this.fetchReport();
                        this.isPrintingVendor = true;
                        setTimeout(() => { window.print(); setTimeout(() => { this.isPrintingVendor = false; }, 3000); }, 500);
                        this.fetchCatalog(); 
                    } else {
                        alert('Gagal menyimpan!\nAlasan Server: ' + (result.message || 'Error Database Tidak Dikenal'));
                    }
                }
            } catch(e) { alert('Error koneksi.'); }
            finally { this.isProcessing = false; }
        },

        reprintVendorNota(notaDetail) {
            const reconstructedCart = notaDetail.cart.map(c => {
                if(c.name) return c; 
                const prod = this.products.find(p => p.id === c.id || p.id === c[0]); 
                return { 
                    name: prod ? prod.name : 'Produk', 
                    qty: c.qty || c[1], 
                    buyPrice: c.buyPrice || c[2], 
                    returQty: c.returQty || c[3] || 0 
                };
            });
            
            this.lastVendorTx = {
                invoice: notaDetail.invoice,
                date: new Date().toLocaleString('id-ID'), 
                supplier: notaDetail.supplier || 'Data Lama (Tanpa Nama)',
                cart: reconstructedCart,
                total: notaDetail.total,
                discount: notaDetail.discount,
                grandTotal: notaDetail.grandTotal,
                method: notaDetail.method,
                notes: this.cleanNotes(notaDetail.keteranganManual)
            };
            this.isPrintingVendor = true;
            setTimeout(() => { window.print(); setTimeout(() => { this.isPrintingVendor = false; }, 3000); }, 500);
        },

        async deleteVendorNota(id, detailNota) {
            const namaSup = detailNota.supplier || 'Vendor';
            const sandi = prompt(`🔒 HAPUS NOTA VENDOR\nMasukkan PIN Admin untuk menghapus nota dari ${namaSup} dan mengembalikan stok:`); 
            if (!sandi) return;
            
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ Akses ditolak! PIN Salah.");
                
                if (!confirm(`⚠️ YAKIN HAPUS NOTA ${detailNota.invoice}?\nIni akan MENGHAPUS pengeluaran kas. Stok kue mohon dikurangi manual di Master Produk.`)) return;

                const res = await fetch(`${SERVER_URL}/api/expenses/${id}`, { method: 'DELETE' });
                if ((await res.json()).success) { 
                    alert(`✅ Nota dan Pengeluaran Kas berhasil dihapus.\n\n⚠️ PENTING: Sistem tidak mengurangi stok kue secara otomatis. Silakan kurangi stok kue secara manual di menu Master Produk jika perlu.`); 
                    this.fetchReport(); 
                } 
            } catch (e) {
                alert('Gagal menghapus nota.');
            }
        },

        async deleteStockHistory(id) {
            const sandi = prompt(`🔒 BATALKAN STOK MASUK\nMasukkan PIN Admin untuk menghapus riwayat dan mengurangi stok kue di etalase:`); 
            if (!sandi) return;
            
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ Akses ditolak! PIN Salah.");
                
                if (!confirm(`⚠️ YAKIN MEMBATALKAN STOK INI?\nStok fisik produk ini di etalase akan otomatis dikurangi/ditarik kembali.`)) return;

                const res = await fetch(`${SERVER_URL}/api/stock-history/${id}`, { method: 'DELETE' });
                if ((await res.json()).success) { 
                    alert(`✅ Berhasil! Riwayat penerimaan barang dihapus dan stok kue telah dikurangi.`); 
                    this.fetchReport(); 
                    this.fetchCatalog(); 
                } else {
                    alert('Gagal menghapus riwayat stok.');
                }
            } catch (e) {
                alert('Error saat menghapus riwayat stok.');
            }
        },

        async fetchReport() {
            try {
                let queryParam = `?period=${this.reportPeriod}`;
                if (this.reportPeriod === 'custom') { if (!this.startDate || !this.endDate) return alert('Isi Tanggal!'); queryParam += `&start=${this.startDate}&end=${this.endDate}`; }
                const resGlobal = await fetch(`${SERVER_URL}/api/reports${queryParam}`); if((await resGlobal.clone().json()).success) this.reportData = (await resGlobal.json()).data;
                const resItems = await fetch(`${SERVER_URL}/api/reports/items${queryParam}`); if((await resItems.clone().json()).success) this.itemReports = (await resItems.json()).data;
            } catch (error) {}
        },

        reprintTransaction(tx) {
            let reconstructedCart = [];
            
            if (tx.items) {
                const parts = tx.items.split(', ');
                reconstructedCart = parts.map(p => {
                    let name = p.trim();
                    let qty = 1;
                    const match = p.match(/(.*) \(x(\d+)\)/);
                    if (match) { name = match[1].trim(); qty = parseInt(match[2]); }
                    let foundProduct = this.products.find(prod => prod.name === name);
                    let price = foundProduct ? foundProduct.price : 0;
                    return { name: name, qty: qty, price: price };
                });
            }

            let isPkg = (tx.invoice && tx.invoice.startsWith('PKT-')) || this.isPaket(reconstructedCart);
            let isPoDP = tx.invoice && tx.invoice.startsWith('DP-');
            let totalQty = reconstructedCart.reduce((sum, i) => sum + (i.qty || 1), 0);

            this.lastTx = {
                invoice: tx.invoice + " (COPY)",
                date: new Date(tx.time).toLocaleString('id-ID'),
                cart: reconstructedCart,
                total: tx.total,
                cash: tx.total, 
                change: 0,
                isPackage: isPkg,
                method: tx.paymentMethod || 'Tunai',
                totalQty: totalQty,
                isPO: isPoDP,
                downPayment: isPoDP ? tx.total : 0,
                remaining: 0,
                shippingCost: 0
            };
            this.printReceipt();
        },

        async batalPiutang(invoice) {
            const sandi = prompt(`🔒 BATALKAN KASBON / PIUTANG\nMasukkan PIN Admin untuk menghapus piutang dari ${invoice.split(' [')[0]} dan mengembalikan stok ke etalase:`); 
            if (!sandi) return;
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ Akses ditolak! PIN Salah.");
                if (!confirm(`⚠️ YAKIN MENGHAPUS PIUTANG INI?\nStok kue di etalase akan otomatis ditarik kembali/ditambahkan.`)) return;

                const res = await fetch(`${SERVER_URL}/api/transactions/${invoice}`, { method: 'DELETE' });
                if ((await res.json()).success) { 
                    alert(`✅ Kasbon berhasil dibatalkan. Stok kue sudah dikembalikan.`); 
                    this.fetchPiutang(); this.fetchReport(); this.fetchCatalog();
                } else { alert('Gagal menghapus kasbon.'); }
            } catch (e) { alert('Error saat menghapus kasbon.'); }
        },

        async terimaPelunasan(invoice) {
            const method = prompt(`💰 TERIMA PELUNASAN KASBON\n\nPelanggan: ${invoice.split(' [')[0]}\n\nUang pelunasan dibayar menggunakan apa?\nKetik "1" untuk TUNAI\nKetik "2" untuk QRIS / Transfer`, '1');
            if (method === null) return; const newMethod = method === '2' ? 'QRIS' : 'Tunai';
            if (!confirm(`Tandai piutang ini LUNAS menggunakan ${newMethod.toUpperCase()}?\n\nUang akan langsung tercatat masuk ke Laporan Hari Ini.`)) return;
            try {
                const res = await fetch(`${SERVER_URL}/api/transactions/${invoice}/pay`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethod: newMethod }) });
                if ((await res.json()).success) { alert(`✅ BERHASIL! Status piutang lunas dan uang masuk ke Laci Hari Ini.`); if(this.currentTab === 'piutang') this.fetchPiutang(); if(this.currentTab === 'laporan') this.fetchReport(); } 
            } catch (e) {}
        },

        printReceipt() { this.isPrintingReceipt = true; setTimeout(() => { window.print(); setTimeout(() => { this.isPrintingReceipt = false; }, 3000); }, 500); },
        printCatalog() { this.isPrintingCatalog = true; setTimeout(() => { window.print(); setTimeout(() => { this.isPrintingCatalog = false; }, 3000); }, 500); },

        async submitExpense() {
            if(!this.expDesc || !this.expAmount) return alert('Isi keterangan & nominal beban');
            try {
                const payload = { category: this.expCat, description: this.expDesc, amount: this.expAmount, paymentMethod: this.expMethod };
                const res = await fetch(`${SERVER_URL}/api/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if((await res.json()).success) { alert('Tercatat!'); this.expDesc = ''; this.expAmount = ''; this.fetchReport(); }
            } catch(e) {}
        },

        async fetchOptions() {
            try {
                const res = await fetch(`${SERVER_URL}/api/options`); const data = await res.json();
                if (data.success) { 
                    this.options.categories = data.data.categories; 
                    this.options.suppliers = data.data.suppliers; 
                    this.updatePendingDrafts(); 
                }
            } catch(e) {}
        },

        async openAddProduct() {
            const sandi = prompt("🔒 OTORISASI ADMIN\n\nMasukkan PIN Admin Anda untuk menambah produk baru ke dalam sistem:"); if (!sandi) return;
            try {
                const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
                if (!(await resPin.json()).success) return alert("❌ Akses ditolak! PIN yang dimasukkan salah.");
            } catch(e) { return alert("Gagal memverifikasi PIN. Pastikan internet lancar."); }

            this.fetchOptions();
            this.newProduct = { name: '', categoryId: '', supplierId: '', buyPrice: '', sellPrice: '', stock: '', image: '' };
            this.showAddProductModal = true;
            setTimeout(() => { lucide.createIcons(); }, 10);
        },

        closeAddProduct() { this.showAddProductModal = false; },

        async submitProduct() {
            if (!this.newProduct.name || !this.newProduct.categoryId || !this.newProduct.supplierId || !this.newProduct.sellPrice) return alert('Lengkapi data wajib (*)');
            this.isProcessing = true;
            try {
                const res = await fetch(`${SERVER_URL}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.newProduct) });
                const result = await res.json();
                if (result.success) { alert('✅ Produk berhasil ditambahkan!'); this.closeAddProduct(); this.fetchCatalog(); } else { alert('Gagal.'); }
            } catch (e) {} finally { this.isProcessing = false; }
        },

        get totalProductTypes() { return this.products.filter(p => p.type === 'product').length; },
        get totalPhysicalStock() { return this.products.filter(p => p.type === 'product').reduce((sum, p) => sum + (p.stock > 0 ? p.stock : 0), 0); },
        get totalStockValue() { return this.products.filter(p => p.type === 'product').reduce((sum, p) => sum + (p.price * (p.stock > 0 ? p.stock : 0)), 0); },
        
        async updateStock(product) {
            const sandi = prompt("🔒 Masukkan PIN Admin:"); if (!sandi) return;
            const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
            if (!(await resPin.json()).success) return alert("❌ Akses ditolak!");
            const inputStr = prompt(`📦 TAMBAH / KURANGI STOK\n\nProduk: ${product.name}\n\nKetik jumlah kedatangan barang. (Gunakan angka minus jika barang rusak)`, "0");
            if (inputStr === null || inputStr.trim() === "") return alert('Batal.'); const diffQty = parseInt(inputStr); if (isNaN(diffQty) || diffQty === 0) return alert('Batal.');
            const newStock = product.stock + diffQty; if (newStock < 0) return alert('Stok akhir tidak boleh minus!');
            try {
                const res = await fetch(`${SERVER_URL}/api/products/${product.id}/stock-v2`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStock }) });
                if ((await res.json()).success) { 
                    if (diffQty > 0) { localStorage.setItem('last_restock_date_' + product.id, new Date().toISOString()); }
                    alert(`Berhasil!`); this.fetchCatalog(); 
                } 
            } catch (e) {}
        },
        
        async deleteTransaction(invoice) {
            const sandi = prompt(`🔒 HAPUS STRUK ${invoice}\nMasukkan PIN Admin:`); if (!sandi) return;
            const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
            if (!(await resPin.json()).success) return alert("❌ Akses ditolak!");
            if (!confirm(`⚠️ YAKIN INGIN MEMBATALKAN STRUK ${invoice}?`)) return;
            try {
                const res = await fetch(`${SERVER_URL}/api/transactions/${invoice}`, { method: 'DELETE' });
                if ((await res.json()).success) { alert(`Struk dihapus & stok dikembalikan.`); this.fetchReport(); this.fetchCatalog(); } 
            } catch (e) {}
        },

        async deleteExpense(id) {
            const sandi = prompt(`🔒 HAPUS PENGELUARAN\nMasukkan PIN Admin:`); if (!sandi) return;
            const resPin = await fetch(`${SERVER_URL}/api/settings/verify-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: sandi }) });
            if (!(await resPin.json()).success) return alert("❌ Akses ditolak!");
            if (!confirm(`⚠️ YAKIN INGIN MENGHAPUS PENGELUARAN INI?`)) return;
            try {
                const res = await fetch(`${SERVER_URL}/api/expenses/${id}`, { method: 'DELETE' });
                if ((await res.json()).success) { alert(`Pengeluaran dihapus.`); this.fetchReport(); } 
            } catch (e) {}
        }
    }
}