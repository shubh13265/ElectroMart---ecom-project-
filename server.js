const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection pool
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'shubh',
    database: 'ecom',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
db.getConnection()
    .then(conn => {
        console.log('✅ MySQL database connected successfully');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });

// ============================================================================
// AUTHENTICATION & USER ENDPOINTS
// ============================================================================

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, phone } = req.body;
        if (!username || !email || !password || !phone) return res.status(400).json({ message: 'All fields required' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute('INSERT INTO users (username, email, password, phone, role) VALUES (?, ?, ?, ?, ?)', [username, email, hashedPassword, phone, 'user']);
        res.status(201).json({ message: 'User registered', userId: result.insertId });
    } catch (err) { 
        console.error('Registration error:', err);
        res.status(500).json({ message: 'Error registering: ' + err.message }); 
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) return res.status(401).json({ message: 'Invalid credentials' });
        res.json({ message: 'Login successful', user: users[0] });
    } catch (err) { 
        console.error('Login error:', err);
        res.status(500).json({ message: 'Login error: ' + err.message }); 
    }
});

app.put('/api/user/update', async (req, res) => {
    try {
        const { userId, username, phone, address } = req.body;
        await db.execute('UPDATE users SET username = ?, phone = ?, address = ? WHERE user_id = ?', [username, phone, address, userId]);
        const [users] = await db.execute('SELECT * FROM users WHERE user_id = ?', [userId]);
        res.json({ message: 'Profile updated', user: users[0] });
    } catch (err) { res.status(500).json({ message: 'Update error' }); }
});

// ============================================================================
// PRODUCT ENDPOINTS
// ============================================================================

app.get('/api/products', async (req, res) => {
    try {
        const { search, category, sort } = req.query;
        let sql = 'SELECT * FROM products WHERE 1=1';
        const params = [];

        if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
        if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }

        if (sort === 'price-asc') sql += ' ORDER BY price ASC';
        else if (sort === 'price-desc') sql += ' ORDER BY price DESC';
        else if (sort === 'name-asc') sql += ' ORDER BY name ASC';
        else if (sort === 'name-desc') sql += ' ORDER BY name DESC';
        else sql += ' ORDER BY product_id DESC';

        const [products] = await db.execute(sql, params);
        res.json(products);
    } catch (err) { res.status(500).json({ message: 'Error fetching products' }); }
});

app.get('/api/products/:id', async (req, res) => {
    const [products] = await db.execute('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    res.json(products[0]);
});

// ============================================================================
// ORDER ENDPOINTS
// ============================================================================

app.post('/api/create-order', async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { userId, productId, totalAmount, shippingAddress, paymentMethod } = req.body;
        await conn.beginTransaction();
        
        const [prod] = await conn.execute('SELECT stock_quantity, name FROM products WHERE product_id = ?', [productId]);
        if (prod[0].stock_quantity < 1) throw new Error('Out of stock');
        
        const productName = `${prod[0].name} (x1)`;

        const [order] = await conn.execute(
            'INSERT INTO orders (user_id, product_names, total_amount, shipping_address, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, productName, totalAmount, shippingAddress, paymentMethod, 'Processing']
        );

        await conn.execute('INSERT INTO order_items (order_id, product_id, quantity, price, price_per_item) VALUES (?, ?, ?, ?, ?)', 
            [order.insertId, productId, 1, totalAmount, totalAmount]);
        
        await conn.execute('UPDATE products SET stock_quantity = stock_quantity - 1 WHERE product_id = ?', [productId]);
        
        await conn.commit();
        res.status(201).json({ message: 'Order placed', orderId: order.insertId });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ message: err.message });
    } finally { conn.release(); }
});

app.post('/api/create-bulk-order', async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { userId, items, totalAmount, shippingAddress, paymentMethod } = req.body;
        await conn.beginTransaction();

        let productSummary = [];
        for (const item of items) {
             const [prod] = await conn.execute('SELECT stock_quantity, name FROM products WHERE product_id = ?', [item.productId]);
             if (prod[0].stock_quantity < item.quantity) {
                 await conn.rollback();
                 return res.status(400).json({ message: `Insufficient stock for ${prod[0].name}` });
             }
             productSummary.push(`${prod[0].name} (x${item.quantity})`);
        }
        const summaryString = productSummary.join(', ');

        const [order] = await conn.execute(
            'INSERT INTO orders (user_id, product_names, total_amount, shipping_address, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, summaryString, totalAmount, shippingAddress, paymentMethod, 'Processing']
        );

        for (const item of items) {
            await conn.execute('INSERT INTO order_items (order_id, product_id, quantity, price, price_per_item) VALUES (?, ?, ?, ?, ?)',
                [order.insertId, item.productId, item.quantity, item.price * item.quantity, item.price]);
            
            await conn.execute('UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?', [item.quantity, item.productId]);
        }

        await conn.commit();
        res.status(201).json({ message: 'Order placed', orderId: order.insertId, itemsCount: items.length });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ message: 'Order failed' });
    } finally { conn.release(); }
});

app.get('/api/my-orders/:userId', async (req, res) => {
    const sql = `
        SELECT o.order_id, o.total_amount, o.order_date, o.status, o.shipping_address, o.payment_method, o.product_names,
        oi.product_id, oi.quantity, oi.price_per_item, p.name AS product_name, p.image_url
        FROM orders o 
        JOIN order_items oi ON o.order_id = oi.order_id 
        JOIN products p ON oi.product_id = p.product_id 
        WHERE o.user_id = ? ORDER BY o.order_date DESC`;
    const [orders] = await db.execute(sql, [req.params.userId]);
    res.json(orders);
});

app.delete('/api/cancel-order/:orderId', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [req.params.orderId]);
        for (const item of items) await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?', [item.quantity, item.product_id]);
        await conn.execute('DELETE FROM order_items WHERE order_id = ?', [req.params.orderId]);
        await conn.execute('DELETE FROM orders WHERE order_id = ?', [req.params.orderId]);
        await conn.commit();
        res.json({ message: 'Order cancelled' });
    } catch (err) { await conn.rollback(); res.status(500).json({ message: 'Error' }); } finally { conn.release(); }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

// Endpoint 14: Get all orders (UPDATED: Now selects shipping_address & payment_method)
app.get('/api/admin/orders', async (req, res) => {
    try {
        const sql = `
            SELECT 
                o.order_id, 
                o.user_id, 
                u.username, 
                o.product_names, 
                o.total_amount, 
                o.order_date, 
                o.status,
                o.shipping_address,  -- Added this
                o.payment_method,    -- Added this
                (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.user_id 
            ORDER BY o.order_date DESC
        `;
        const [orders] = await db.execute(sql);
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.put('/api/admin/orders/status', async (req, res) => {
    try {
        const { orderId, status } = req.body;
        await db.execute('UPDATE orders SET status = ? WHERE order_id = ?', [status, orderId]);
        res.json({ message: 'Order status updated' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// (Standard Admin Product/User Endpoints)
app.post('/api/admin/products', async (req, res) => {
    const { name, description, price, stock_quantity, category, image_url } = req.body;
    await db.execute('INSERT INTO products (name, description, price, stock_quantity, category, image_url) VALUES (?, ?, ?, ?, ?, ?)', [name, description, price, stock_quantity, category, image_url]);
    res.status(201).json({ message: 'Added' });
});
app.put('/api/admin/products/:id', async (req, res) => {
    const { name, description, price, stock_quantity, category, image_url } = req.body;
    await db.execute('UPDATE products SET name=?, description=?, price=?, stock_quantity=?, category=?, image_url=? WHERE product_id=?', [name, description, price, stock_quantity, category, image_url, req.params.id]);
    res.json({ message: 'Updated' });
});
app.delete('/api/admin/products/:id', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await conn.execute('DELETE FROM cart WHERE product_id=?', [req.params.id]);
        const [inOrders] = await conn.execute('SELECT item_id FROM order_items WHERE product_id=? LIMIT 1', [req.params.id]);
        if(inOrders.length>0) { await conn.execute('UPDATE products SET stock_quantity=0 WHERE product_id=?', [req.params.id]); await conn.commit(); return res.json({message:'Sold item. Stock set to 0.'}); }
        await conn.execute('DELETE FROM products WHERE product_id=?', [req.params.id]);
        await conn.commit();
        res.json({ message: 'Deleted' });
    } catch(e) { await conn.rollback(); res.status(500).json({message:'Error'}); } finally { conn.release(); }
});
app.get('/api/admin/revenue', async (req, res) => {
    const [s] = await db.execute('SELECT COUNT(order_id) as total_orders, SUM(total_amount) as total_revenue FROM orders');
    res.json(s[0]);
});
app.get('/api/admin/users', async (req, res) => {
    const [u] = await db.execute('SELECT * FROM users');
    res.json(u);
});

// --- CART ---
app.get('/api/cart/:userId', async (req, res) => {
    const [c] = await db.execute('SELECT c.cart_id, c.product_id, c.quantity, p.name, p.price, p.image_url, p.category FROM cart c JOIN products p ON c.product_id = p.product_id WHERE c.user_id = ?', [req.params.userId]);
    res.json(c);
});
app.post('/api/cart/add', async (req, res) => {
    const { userId, productId, quantity } = req.body;
    const [e] = await db.execute('SELECT * FROM cart WHERE user_id=? AND product_id=?', [userId, productId]);
    if(e.length > 0) await db.execute('UPDATE cart SET quantity=quantity+? WHERE cart_id=?', [quantity, e[0].cart_id]);
    else await db.execute('INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)', [userId, productId, quantity]);
    res.json({ message: 'Added' });
});
app.put('/api/cart/update', async (req, res) => {
    if(req.body.quantity < 1) await db.execute('DELETE FROM cart WHERE cart_id=?', [req.body.cartId]);
    else await db.execute('UPDATE cart SET quantity=? WHERE cart_id=?', [req.body.quantity, req.body.cartId]);
    res.json({ message: 'Updated' });
});
app.delete('/api/cart/remove/:id', async (req, res) => {
    await db.execute('DELETE FROM cart WHERE cart_id=?', [req.params.id]);
    res.json({ message: 'Removed' });
});
app.delete('/api/cart/clear/:id', async (req, res) => {
    await db.execute('DELETE FROM cart WHERE user_id=?', [req.params.id]);
    res.json({ message: 'Cleared' });
});
app.listen(port, () => {
    console.log(`✅ Backend server running on http://localhost:${port}`);
    console.log(`📊 Total API Endpoints: 21`);
    console.log(`🔐 Database: ecom_db`);
    console.log(`🚀 Server ready to handle requests!`);
});
