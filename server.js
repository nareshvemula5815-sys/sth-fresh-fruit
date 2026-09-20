const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");
try { require("dotenv").config(); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const db = new Database("sth_fresh_fruit.db");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 phone TEXT,
 password TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'customer',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 price REAL NOT NULL,
 unit TEXT NOT NULL DEFAULT '1 kg',
 image TEXT NOT NULL,
 description TEXT,
 stock INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 total REAL NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'PENDING',
 order_status TEXT NOT NULL DEFAULT 'PLACED',
 address TEXT NOT NULL,
 razorpay_order_id TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL,
 price REAL NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

const admin = db.prepare("SELECT id FROM users WHERE email=?").get("admin@sthfreshfruit.in");
if (!admin) {
  const hash = bcrypt.hashSync("Admin@123", 10);
  db.prepare("INSERT INTO users(name,email,phone,password,role) VALUES(?,?,?,?,?)")
    .run("STH Admin", "admin@sthfreshfruit.in", "9000000000", hash, "admin");
}

const count = db.prepare("SELECT COUNT(*) c FROM products").get().c;
if (!count) {
  const products = [
    ["Alphonso Mango","Mango",149,"1 kg","https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=900&q=85","Naturally sweet seasonal mangoes.",80],
    ["Fresh Bananas","Banana",59,"1 dozen","https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=900&q=85","Fresh ripe bananas for everyday nutrition.",120],
    ["Red Apples","Apple",169,"1 kg","https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=900&q=85","Crisp, juicy premium apples.",75],
    ["Nagpur Oranges","Orange",119,"1 kg","https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=900&q=85","Juicy citrus oranges.",90],
    ["Green Grapes","Grapes",129,"500 g","https://images.unsplash.com/photo-1537640538966-79f369143f8f?auto=format&fit=crop&w=900&q=85","Sweet and fresh table grapes.",65],
    ["Watermelon","Melon",69,"1 piece","https://images.unsplash.com/photo-1563114773-84221bd62daa?auto=format&fit=crop&w=900&q=85","Refreshing, chilled-ready watermelon.",45],
    ["Pomegranate","Pomegranate",199,"1 kg","https://images.unsplash.com/photo-1541344999736-83eca272f6fc?auto=format&fit=crop&w=900&q=85","Ruby-red arils with rich flavour.",50],
    ["Papaya","Papaya",79,"1 kg","https://images.unsplash.com/photo-1526318472351-c75fcf070305?auto=format&fit=crop&w=900&q=85","Soft, naturally sweet papaya.",55]
  ];
  const ins = db.prepare("INSERT INTO products(name,category,price,unit,image,description,stock) VALUES(?,?,?,?,?,?,?)");
  const tx = db.transaction(() => products.forEach(p=>ins.run(...p)));
  tx();
}

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next){
  const h=req.headers.authorization||"";
  try { req.user=jwt.verify(h.replace("Bearer ",""),JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Please login"}); }
}
function adminOnly(req,res,next){ if(req.user?.role!=="admin") return res.status(403).json({error:"Admin only"}); next(); }

app.post("/api/register",(req,res)=>{
  const {name,email,phone,password}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
  try{
    const hash=bcrypt.hashSync(password,10);
    const info=db.prepare("INSERT INTO users(name,email,phone,password) VALUES(?,?,?,?)").run(name,email,phone||"",hash);
    const user={id:info.lastInsertRowid,name,email,role:"customer"};
    const token=jwt.sign(user,JWT_SECRET,{expiresIn:"7d"});
    res.json({token,user});
  }catch(e){res.status(400).json({error:"Email already registered"});}
});
app.post("/api/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
  if(!u||!bcrypt.compareSync(req.body.password||"",u.password)) return res.status(401).json({error:"Invalid email or password"});
  const user={id:u.id,name:u.name,email:u.email,role:u.role};
  res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:"7d"}),user});
});
app.get("/api/products",(req,res)=>{
  const q=(req.query.q||"").trim(), cat=req.query.category||"";
  let sql="SELECT * FROM products WHERE active=1", params=[];
  if(q){sql+=" AND (name LIKE ? OR category LIKE ?)"; params.push("%"+q+"%","%"+q+"%");}
  if(cat){sql+=" AND category=?"; params.push(cat);}
  res.json(db.prepare(sql+" ORDER BY id DESC").all(...params));
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));

app.post("/api/orders",auth,(req,res)=>{
  const {items,address}=req.body;
  if(!Array.isArray(items)||!items.length||!address) return res.status(400).json({error:"Cart and address are required"});
  let total=0, checked=[];
  for(const i of items){
    const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(i.product_id);
    if(!p || i.quantity<1 || i.quantity>p.stock) return res.status(400).json({error:"Product unavailable or insufficient stock"});
    total += p.price*i.quantity; checked.push({p,quantity:i.quantity});
  }
  let razorpay_order_id=null;
  if(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET){
    const rzp=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
    const rorder=awaitRzp(rzp.orders.create({amount:Math.round(total*100),currency:"INR",receipt:"STH-"+Date.now()}));
    razorpay_order_id=rorder.id;
  }
  const orderInfo=db.prepare("INSERT INTO orders(user_id,total,address,razorpay_order_id) VALUES(?,?,?,?)")
    .run(req.user.id,total,address,razorpay_order_id);
  const ins=db.prepare("INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(?,?,?,?)");
  const dec=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
  const tx=db.transaction(()=>checked.forEach(x=>{ins.run(orderInfo.lastInsertRowid,x.p.id,x.quantity,x.p.price);dec.run(x.quantity,x.p.id);}));
  tx();
  res.json({order_id:orderInfo.lastInsertRowid,total,razorpay_order_id,key_id:process.env.RAZORPAY_KEY_ID||null});
});
function awaitRzp(p){ return p; }

app.get("/api/orders",auth,(req,res)=>{
  const orders=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  for(const o of orders) o.items=db.prepare(`SELECT oi.quantity,oi.price,p.name,p.image,p.unit FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?`).all(o.id);
  res.json(orders);
});
app.post("/api/orders/:id/paid",auth,(req,res)=>{
  db.prepare("UPDATE orders SET payment_status='PAID' WHERE id=? AND user_id=?").run(req.params.id,req.user.id);
  res.json({ok:true});
});

app.get("/api/admin/stats",auth,adminOnly,(req,res)=>{
  res.json({
    products:db.prepare("SELECT COUNT(*) c FROM products WHERE active=1").get().c,
    customers:db.prepare("SELECT COUNT(*) c FROM users WHERE role='customer'").get().c,
    orders:db.prepare("SELECT COUNT(*) c FROM orders").get().c,
    sales:db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment_status='PAID'").get().s
  });
});
app.get("/api/admin/products",auth,adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));
app.post("/api/admin/products",auth,adminOnly,(req,res)=>{
  const p=req.body;
  const info=db.prepare("INSERT INTO products(name,category,price,unit,image,description,stock) VALUES(?,?,?,?,?,?,?)")
    .run(p.name,p.category,Number(p.price),p.unit,p.image,p.description||"",Number(p.stock||0));
  res.json({id:info.lastInsertRowid});
});
app.put("/api/admin/products/:id",auth,adminOnly,(req,res)=>{
  const p=req.body;
  db.prepare("UPDATE products SET name=?,category=?,price=?,unit=?,image=?,description=?,stock=?,active=? WHERE id=?")
    .run(p.name,p.category,Number(p.price),p.unit,p.image,p.description||"",Number(p.stock||0),Number(p.active??1),req.params.id);
  res.json({ok:true});
});
app.delete("/api/admin/products/:id",auth,adminOnly,(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);res.json({ok:true});});
app.get("/api/admin/orders",auth,adminOnly,(req,res)=>res.json(db.prepare(`SELECT o.*,u.name,u.email,u.phone FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC`).all()));
app.put("/api/admin/orders/:id",auth,adminOnly,(req,res)=>{
  db.prepare("UPDATE orders SET order_status=?,payment_status=? WHERE id=?")
    .run(req.body.order_status||"PLACED",req.body.payment_status||"PENDING",req.params.id);
  res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public/index.html")));
app.listen(PORT,()=>console.log(`STH Fresh Fruit running on http://localhost:${PORT}`));
