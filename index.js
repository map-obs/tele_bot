require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
async function initDb() {
  const query = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      product_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      price NUMERIC(10, 2) NOT NULL,
      status VARCHAR(20) DEFAULT 'Available',
      sold_at TIMESTAMP,
      returned_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
    console.log("✅ Neon DB Table initialized successfully.");
  } catch (err) {
    console.error("❌ DB Init Error:", err);
  }
}
initDb();
const bot = new Telegraf(process.env.BOT_TOKEN);
async function answerCallback(ctx) {
  try {
    await ctx.answerCbQuery();
    return true;
  } catch (error) {
    const description = error.response?.description || "";
    if (error.response?.error_code === 400 && /query is too old|query ID is invalid/i.test(description)) {
      return false;
    }
    throw error;
  }
}
const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("📦 ပစ္စည်းများ & Total Price", "view_products")],
  [
    Markup.button.callback("📊 အနှစ်ချုပ် (Summary)", "view_summary"),
    Markup.button.callback("📅 လအလိုက် Report", "monthly_report"),
  ],
]);

bot.start((ctx) => {
  ctx.reply(
    "မင်္ဂလာပါ! Neon DB ဖြင့် ချိတ်ဆက်ထားသော Ecommerce Bot မှ ကြိုဆိုပါသည်၊၊\n\n" +
      "📌 **ပစ္စည်းသစ် ထည့်ရန်:** ဓာတ်ပုံနှင့်အတူ စာရိုက်ပို့ပါ (ဥပမာ- Mango\\n100\\nNo.1)\n\n" +
      "အောက်ပါ ခလုတ်များဖြင့် စာရင်း စစ်ဆေးနိုင်ပါသည်:",
    { parse_mode: "Markdown", ...mainMenuKeyboard },
  );
});
bot.on("photo", async (ctx) => {
  const caption = ctx.message.caption;
  if (!caption)
    return ctx.reply(
      "⚠️ ကျေးဇူးပြု၍ ဓာတ်ပုံနှင့်အတူ စာ (Name\\nPrice\\nID) ကို တွဲပို့ပေးပါ။",
    );

  const lines = caption.split("\n");
  if (lines.length < 3) {
    return ctx.reply(
      "⚠️ စာပို့သည့် ပုံစံ မမှန်ပါ။ အောက်ပါအတိုင်း ပို့ပေးပါ-\n\nMango\n100\nNo.1",
    );
  }

  const name = lines[0].trim();
  const price = parseFloat(lines[1].trim());
  const productId = lines[2].trim();

  try {
    const insertQuery = `
      INSERT INTO products (product_id, name, price)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    await pool.query(insertQuery, [productId, name, price]);

    ctx.reply(
      `✅ Neon DB ထဲသို့ ပစ္စည်းစာရင်း သွင်းပြီးပါပြီ!\n\n🏷 Name: ${name}\n💰 Price: ${price} KS\n🆔 ID: ${productId}`,
    );
  } catch (error) {
    if (error.code === "23505") {
      ctx.reply(
        `⚠️ ID: ${productId} ကို အသုံးပြုပြီးသား ဖြစ်နေပါသည်။ အခြား ID သုံးပေးပါ။`,
      );
    } else {
      console.error(error);
      ctx.reply("❌ DB သို့ စာရင်းသွင်းရာတွင် အမှားအယွင်း ရှိနေပါသည်။");
    }
  }
});

bot.action("view_products", async (ctx) => {
  if (!(await answerCallback(ctx))) return;
  try {
    const res = await pool.query("SELECT * FROM products ORDER BY id DESC");
    const products = res.rows;

    if (products.length === 0) {
      return ctx.editMessageText(
        "📦 လက်ရှိ စာရင်းသွင်းထားသော ပစ္စည်းမရှိသေးပါ။",
        mainMenuKeyboard,
      );
    }

    let text = "📋 **လက်ရှိ ပစ္စည်းများ စာရင်း (Neon DB)**\n\n";
    let availableTotal = 0;
    let buttons = [];

    products.forEach((item) => {
      let statusIcon = "✅ ရောင်းရန်ရှိ";
      if (item.status === "Sold") statusIcon = "❌ ရောင်းပြီး";
      if (item.status === "Returned") statusIcon = "↩️ ပြန်အပ်";

      text += `🔹 **ID:** ${item.product_id} | **${item.name}** - ${item.price} KS [${statusIcon}]\n`;

      if (item.status === "Available") {
        availableTotal += parseFloat(item.price);
        buttons.push([
          Markup.button.callback(
            `🛒 ရောင်းမည် (${item.product_id})`,
            `sell_${item.product_id}`,
          ),
          Markup.button.callback(
            `↩️ Return (${item.product_id})`,
            `return_${item.product_id}`,
          ),
        ]);
      }
    });

    text += `\n💰 **ရောင်းရန်ကျန် စုစုပေါင်းတန်ဖိုး:** ${availableTotal} KS`;
    buttons.push([Markup.button.callback("🔄 Refresh", "view_products")]);

    ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    console.error(error);
    ctx.reply("❌ စာရင်း ဆွဲထုတ်ရာတွင် အမှားအယွင်း ရှိနေပါသည်။");
  }
});
bot.action(/^sell_(.+)$/, async (ctx) => {
  if (!(await answerCallback(ctx))) return;
  const itemId = ctx.match[1];
  try {
    const updateQuery = `
      UPDATE products
      SET status = 'Sold', sold_at = NOW()
      WHERE product_id = $1 AND status = 'Available'
      RETURNING *;
    `;
    const res = await pool.query(updateQuery, [itemId]);

    if (res.rowCount > 0) {
      await ctx.reply("✅ ရောင်းပြီးအဖြစ် မှတ်တမ်းတင်လိုက်ပါပြီ!");
    } else {
      await ctx.reply("⚠️ ဒီပစ္စည်းက ရောင်းပြီးသား (သို့) မရှိတော့ပါ!");
    }

    return ctx.reply(
      "အောက်ပါ Button ကိုနှိပ်၍ စာရင်းအသစ် ပြန်ကြည့်ပါ-",
      mainMenuKeyboard,
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Error ဖြစ်ပေါ်ခဲ့ပါသည်။");
  }
});
bot.action(/^return_(.+)$/, async (ctx) => {
  if (!(await answerCallback(ctx))) return;
  const itemId = ctx.match[1];
  try {
    const updateQuery = `
      UPDATE products
      SET status = 'Returned', returned_at = NOW()
      WHERE product_id = $1
      RETURNING *;
    `;
    await pool.query(updateQuery, [itemId]);
    await ctx.reply("↩️ Returned ပစ္စည်းအဖြစ် မှတ်တမ်းတင်လိုက်ပါပြီ!");
    return ctx.reply(
      "အောက်ပါ Button ကိုနှိပ်၍ စာရင်းအသစ် ပြန်ကြည့်ပါ-",
      mainMenuKeyboard,
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Error ဖြစ်ပေါ်ခဲ့ပါသည်။");
  }
});

bot.action("view_summary", async (ctx) => {
  if (!(await answerCallback(ctx))) return;
  try {
    const query = `
      SELECT status, COUNT(*) as count, SUM(price) as total
      FROM products
      GROUP BY status;
    `;
    const res = await pool.query(query);

    let soldTotal = 0,
      returnedTotal = 0,
      availableTotal = 0;
    let soldCount = 0,
      returnedCount = 0,
      availableCount = 0;

    res.rows.forEach((row) => {
      const sum = parseFloat(row.total || 0);
      const cnt = parseInt(row.count, 10);
      if (row.status === "Sold") {
        soldTotal = sum;
        soldCount = cnt;
      }
      if (row.status === "Returned") {
        returnedTotal = sum;
        returnedCount = cnt;
      }
      if (row.status === "Available") {
        availableTotal = sum;
        availableCount = cnt;
      }
    });

    let text = `📊 **Neon DB အရောင်းအဝယ် အနှစ်ချုပ်**\n\n`;
    text += `✅ **ရောင်းရန်ကျန် (Available):** ${availableCount} ခု (${availableTotal} KS)\n`;
    text += `💰 **ရောင်းပြီး (Sold Total):** ${soldCount} ခု (${soldTotal} KS)\n`;
    text += `↩️ **ပြန်အပ် (Returned Total):** ${returnedCount} ခု (${returnedTotal} KS)\n\n`;
    text += `💵 **Net Revenue (ရောင်းရငွေ - Return):** ${soldTotal - returnedTotal} KS`;

    ctx.editMessageText(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
  } catch (error) {
    console.error(error);
    ctx.reply("❌ Summary တွက်ချက်ရာတွင် အမှားအယွင်း ရှိနေပါသည်။");
  }
});
bot.action("monthly_report", async (ctx) => {
  if (!(await answerCallback(ctx))) return;
  try {
    const query = `
      SELECT TO_CHAR(sold_at, 'YYYY-MM') as month, COUNT(*) as total_items, SUM(price) as total_sales
      FROM products
      WHERE status = 'Sold'
      GROUP BY TO_CHAR(sold_at, 'YYYY-MM')
      ORDER BY month DESC;
    `;
    const res = await pool.query(query);

    if (res.rows.length === 0) {
      return ctx.editMessageText(
        "📅 လအလိုက် ရောင်းရသည့် စာရင်း မရှိသေးပါ။",
        mainMenuKeyboard,
      );
    }

    let text = `📅 **လအလိုက် အရောင်းအဝယ် အစီရင်ခံစာ**\n\n`;
    res.rows.forEach((row) => {
      text += `🗓 **${row.month}:** ${row.total_items} ခု ရောင်းရ | **${row.total_sales} KS**\n`;
    });

    ctx.editMessageText(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
  } catch (error) {
    console.error(error);
    ctx.reply("❌ Report ထုတ်ယူရာတွင် အမှားအယွင်း ရှိနေပါသည်။");
  }
});

bot.launch();
console.log("🚀 Neon DB Telegram Bot is running...");

process.once("SIGINT", () => {
  pool.end();
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  pool.end();
  bot.stop("SIGTERM");
});
