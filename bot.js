const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql');
const axios = require('axios');

// Replace with your actual token from BotFather
const token = '7366996102:AAGHAJw3DCZ9mw0KZYwG09b2YihxEBNYOlw';
const bot = new TelegramBot(token, { polling: true });

// MySQL Database Connection Setup
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'zureum'  // You can set up this database in Step 3
});

db.connect((err) => {
    if (err) throw err;
    console.log('Database connected!');
});

// const cryptoPrices = {
//     BTC: 50000,  // Example: BTC is $50,000
//     ETH: 3000,   // Example: ETH is $3,000
//     XRP: 1       // Example: XRP is $1
// };


async function getCryptoPrice(symbol) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple&vs_currencies=usd`);
        const prices = response.data;

        switch (symbol) {
            case 'BTC':
                return prices.bitcoin.usd;
            case 'ETH':
                return prices.ethereum.usd;
            case 'XRP':
                return prices.ripple.usd;
            default:
                return null;
        }
    } catch (error) {
        console.error("Error fetching live price:", error);
        return null;
    }
}

// const price = await getCryptoPrice(symbol);
// if (!price) {
//     bot.sendMessage(chatId, "Unable to fetch live price. Please try again later.");
//     return;
// }

// Start Command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    const telegramId = msg.from.id;

    db.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, results) => {
        if (err) throw err;

        let welcomeMessage;
        if (results.length === 0) {
            db.query('INSERT INTO users (telegram_id, username, balance) VALUES (?, ?, 10000)', [telegramId, username], (err) => {
                if (err) throw err;
                welcomeMessage = `Welcome to ZureumBot, ${username}! Your account has been created with a starting balance of $10,000.\n\n`;
            });
        } else {
            welcomeMessage = `Welcome back to ZureumBot, ${username}!\n\n`;
        }

        const helpMessage = `
${welcomeMessage}Here’s a quick guide to get you started:

🔹 **Check Balance and Portfolio**  
🔹 **Buy Cryptocurrency**  
🔹 **Sell Cryptocurrency**  
🔹 **View Transaction History**  
🔹 **Leaderboard**

Use the buttons below to access these features directly.
        `;

        // Define inline keyboard buttons
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "📊 View Portfolio", callback_data: 'portfolio' },
                        { text: "💸 Buy Crypto", callback_data: 'buy' },
                        { text: "💰 Sell Crypto", callback_data: 'sell' }
                    ],
                    [
                        { text: "📜 Transaction History", callback_data: 'history' },
                        { text: "🏆 Leaderboard", callback_data: 'leaderboard' }
                    ]
                ]
            }
        };

        // Send the welcome and help message with buttons
        bot.sendMessage(chatId, helpMessage, options)
            .then(() => console.log("Welcome and help message with buttons sent successfully"))
            .catch((error) => console.error("Error sending welcome and help message:", error));
    });
});



bot.onText(/\/portfolio/, (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    db.query('SELECT balance FROM users WHERE telegram_id = ?', [telegramId], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            const balance = results[0].balance;
            let portfolioMessage = `Your current balance is $${balance.toFixed(2)}\n\nPortfolio:\n`;

            db.query('SELECT crypto_symbol, quantity FROM portfolios WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [telegramId], (err, portfolio) => {
                if (err) throw err;

                portfolio.forEach(asset => {
                    portfolioMessage += `${asset.crypto_symbol}: ${asset.quantity.toFixed(6)}\n`;
                });

                bot.sendMessage(chatId, portfolioMessage);
            });
        } else {
            bot.sendMessage(chatId, "Please use /start to register first.");
        }
    });
});


// buy
bot.onText(/\/buy (\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const symbol = match[1].toUpperCase();
    const amount = parseFloat(match[2]);

    // Get real-time price
    const price = await getCryptoPrice(symbol);
    if (!price) {
        bot.sendMessage(chatId, "Unable to fetch live price. Please try again later.");
        return;
    }

    const quantity = amount / price;

    db.query('SELECT user_id, balance FROM users WHERE telegram_id = ?', [telegramId], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            bot.sendMessage(chatId, "Please use /start to register first.");
            return;
        }

        const userId = results[0].user_id;
        const balance = results[0].balance;

        if (balance < amount) {
            bot.sendMessage(chatId, "Insufficient balance.");
            return;
        }

        db.beginTransaction((err) => {
            if (err) {
                bot.sendMessage(chatId, "An error occurred. Try again.");
                return;
            }

            // Deduct balance
            db.query('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount, userId], (err) => {
                if (err) {
                    return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                }

                // Check if user already owns this crypto
                db.query('SELECT * FROM portfolios WHERE user_id = ? AND crypto_symbol = ?', [userId, symbol], (err, portfolioResults) => {
                    if (err) {
                        return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                    }

                    const query = portfolioResults.length > 0
                        ? 'UPDATE portfolios SET quantity = quantity + ? WHERE user_id = ? AND crypto_symbol = ?'
                        : 'INSERT INTO portfolios (user_id, crypto_symbol, quantity) VALUES (?, ?, ?)';
                    const params = portfolioResults.length > 0
                        ? [quantity, userId, symbol]
                        : [userId, symbol, quantity];

                    db.query(query, params, (err) => {
                        if (err) {
                            return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                        }

                        // Log the transaction in the transactions table
                        db.query('INSERT INTO transactions (user_id, crypto_symbol, quantity, amount, transaction_type) VALUES (?, ?, ?, ?, "BUY")', [userId, symbol, quantity, amount], (err) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error logging transaction:", err);
                                    bot.sendMessage(chatId, "An error occurred while logging the transaction.");
                                });
                            }

                            // Commit the transaction
                            db.commit((err) => {
                                if (err) {
                                    return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                                }

                                bot.sendMessage(chatId, `You have successfully purchased ${quantity.toFixed(6)} ${symbol} for $${amount}.`);
                                console.log(`Logged buy transaction: ${quantity} ${symbol} for $${amount}`);
                            });
                        });
                    });
                });
            });
        });
    });
});

//sell
bot.onText(/\/sell (\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const symbol = match[1].toUpperCase();
    const amount = parseFloat(match[2]);

    // Get real-time price
    const price = await getCryptoPrice(symbol);
    if (!price) {
        bot.sendMessage(chatId, "Unable to fetch live price. Please try again later.");
        return;
    }

    const quantity = amount / price;

    db.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId], (err, userResults) => {
        if (err) throw err;

        if (userResults.length === 0) {
            bot.sendMessage(chatId, "Please use /start to register first.");
            return;
        }

        const userId = userResults[0].user_id;

        db.query('SELECT quantity FROM portfolios WHERE user_id = ? AND crypto_symbol = ?', [userId, symbol], (err, portfolioResults) => {
            if (err) throw err;

            if (portfolioResults.length === 0 || portfolioResults[0].quantity < quantity) {
                bot.sendMessage(chatId, `Insufficient ${symbol} balance in your portfolio.`);
                return;
            }

            db.beginTransaction((err) => {
                if (err) {
                    bot.sendMessage(chatId, "An error occurred. Try again.");
                    return;
                }

                // Deduct quantity from portfolio
                db.query('UPDATE portfolios SET quantity = quantity - ? WHERE user_id = ? AND crypto_symbol = ?', [quantity, userId, symbol], (err) => {
                    if (err) {
                        return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                    }

                    // Add sale amount to user's balance
                    db.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [amount, userId], (err) => {
                        if (err) {
                            return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                        }

                        // Log the transaction in the transactions table
                        db.query('INSERT INTO transactions (user_id, crypto_symbol, quantity, amount, transaction_type) VALUES (?, ?, ?, ?, "SELL")', [userId, symbol, quantity, amount], (err) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error logging transaction:", err);
                                    bot.sendMessage(chatId, "An error occurred while logging the transaction.");
                                });
                            }

                            // Commit the transaction
                            db.commit((err) => {
                                if (err) {
                                    return db.rollback(() => bot.sendMessage(chatId, "An error occurred during the transaction."));
                                }

                                bot.sendMessage(chatId, `You have successfully sold ${quantity.toFixed(6)} ${symbol} for $${amount}.`);
                                console.log(`Logged sell transaction: ${quantity} ${symbol} for $${amount}`);
                            });
                        });
                    });
                });
            });
        });
    });
});




// Help Command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
Welcome to ZureumBot! Here’s a quick guide on how to use the bot’s features:

🔹 **Check Balance and Portfolio:**
   - Use **/portfolio** to view your current balance and cryptocurrency holdings.
   
🔹 **Buy Cryptocurrency:**
   - Use **/buy <symbol> <amount>** to buy cryptocurrency.
   - Example: **/buy BTC 1000** (to buy $1000 worth of Bitcoin).
   
🔹 **Sell Cryptocurrency:**
   - Use **/sell <symbol> <amount>** to sell cryptocurrency.
   - Example: **/sell BTC 500** (to sell $500 worth of Bitcoin).
   
🔹 **View Transaction History:**
   - Use **/history** to view your last 10 buy and sell transactions.
   - This command shows each transaction’s type (BUY/SELL), amount, cryptocurrency, and date.

🔹 **Leaderboard:**
   - Use **/leaderboard** to see the top 10 users ranked by their portfolio value.
   - The leaderboard shows the usernames and portfolio values of the top traders.

💡 **Available Cryptocurrencies:**
   - BTC (Bitcoin), ETH (Ethereum), XRP (Ripple)

If you need further assistance, please contact support or refer back to this help message.
    `;

    // Send the help message to the user
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' })
        .then(() => console.log("Help message sent successfully"))
        .catch((error) => console.error("Error sending help message:", error));
});


//History 
bot.onText(/\/history/, (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    db.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId], (err, userResults) => {
        if (err || userResults.length === 0) {
            bot.sendMessage(chatId, "Please register first with /start.");
            return;
        }

        const userId = userResults[0].user_id;

        db.query('SELECT crypto_symbol, quantity, amount, transaction_type, transaction_date FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC LIMIT 10', [userId], (err, transactions) => {
            if (err) {
                bot.sendMessage(chatId, "An error occurred while fetching your transaction history.");
                console.error("Error fetching history:", err);
                return;
            }

            if (transactions.length === 0) {
                bot.sendMessage(chatId, "No transactions found in your history.");
                return;
            }

            let historyMessage = "Your Last 10 Transactions:\n\n";
            transactions.forEach(tx => {
                historyMessage += `${tx.transaction_type} ${tx.crypto_symbol}: ${tx.quantity.toFixed(6)} for $${tx.amount.toFixed(2)} on ${tx.transaction_date.toLocaleString()}\n`;
            });

            bot.sendMessage(chatId, historyMessage);
        });
    });
});



// leaderboard 
bot.onText(/\/leaderboard/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const prices = {
            BTC: await getCryptoPrice('BTC'),
            ETH: await getCryptoPrice('ETH'),
            XRP: await getCryptoPrice('XRP')
        };

        db.query(`
            SELECT u.username, u.balance +
            SUM(IF(p.crypto_symbol = 'BTC', p.quantity * ?, 
                   IF(p.crypto_symbol = 'ETH', p.quantity * ?, 
                   IF(p.crypto_symbol = 'XRP', p.quantity * ?, 0)))) AS portfolio_value
            FROM users u
            LEFT JOIN portfolios p ON u.user_id = p.user_id
            GROUP BY u.user_id
            ORDER BY portfolio_value DESC
            LIMIT 10`, [prices.BTC, prices.ETH, prices.XRP], (err, results) => {

            if (err) {
                console.error("Error fetching leaderboard:", err);
                bot.sendMessage(chatId, "An error occurred while fetching the leaderboard.");
                return;
            }

            let leaderboardMessage = "🏆 Top 10 Users by Portfolio Value:\n\n";
            results.forEach((user, index) => {
                leaderboardMessage += `${index + 1}. ${user.username}: $${user.portfolio_value.toFixed(2)}\n`;
            });

            bot.sendMessage(chatId, leaderboardMessage);
        });
    } catch (error) {
        bot.sendMessage(chatId, "An error occurred while fetching the leaderboard.");
        console.error("Error with leaderboard prices:", error);
    }
});


// callback 
bot.on("callback_query", (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    switch (data) {
        case 'portfolio':
            // Fetch and display portfolio
            db.query('SELECT balance FROM users WHERE telegram_id = ?', [chatId], (err, results) => {
                if (err) {
                    bot.sendMessage(chatId, "An error occurred while fetching your balance.");
                    console.error(err);
                    return;
                }

                if (results.length > 0) {
                    const balance = results[0].balance;
                    let portfolioMessage = `Your current balance is $${balance.toFixed(2)}\n\nPortfolio:\n`;

                    db.query('SELECT crypto_symbol, quantity FROM portfolios WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [chatId], (err, portfolio) => {
                        if (err) {
                            bot.sendMessage(chatId, "An error occurred while accessing your portfolio.");
                            console.error(err);
                            return;
                        }

                        portfolio.forEach(asset => {
                            portfolioMessage += `${asset.crypto_symbol}: ${asset.quantity.toFixed(6)}\n`;
                        });

                        bot.sendMessage(chatId, portfolioMessage);
                    });
                } else {
                    bot.sendMessage(chatId, "Please use /start to register first.");
                }
            });
            break;

        case 'buy':
            bot.sendMessage(chatId, "To buy cryptocurrency, use the command: `/buy <symbol> <amount>`\nExample: `/buy BTC 1000`", { parse_mode: 'Markdown' });
            break;

        case 'sell':
            bot.sendMessage(chatId, "To sell cryptocurrency, use the command: `/sell <symbol> <amount>`\nExample: `/sell BTC 500`", { parse_mode: 'Markdown' });
            break;

        case 'history':
            // Fetch and display transaction history
            db.query('SELECT user_id FROM users WHERE telegram_id = ?', [chatId], (err, userResults) => {
                if (err || userResults.length === 0) {
                    bot.sendMessage(chatId, "Please register first with /start.");
                    return;
                }

                const userId = userResults[0].user_id;

                db.query('SELECT crypto_symbol, quantity, amount, transaction_type, transaction_date FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC LIMIT 10', [userId], (err, transactions) => {
                    if (err) {
                        bot.sendMessage(chatId, "An error occurred while fetching your transaction history.");
                        console.error("Error fetching history:", err);
                        return;
                    }

                    if (transactions.length === 0) {
                        bot.sendMessage(chatId, "No transactions found in your history.");
                        return;
                    }

                    let historyMessage = "Your Last 10 Transactions:\n\n";
                    transactions.forEach(tx => {
                        historyMessage += `${tx.transaction_type} ${tx.crypto_symbol}: ${tx.quantity.toFixed(6)} for $${tx.amount.toFixed(2)} on ${new Date(tx.transaction_date).toLocaleString()}\n`;
                    });

                    bot.sendMessage(chatId, historyMessage);
                });
            });
            break;

        case 'leaderboard':
            // Fetch and display leaderboard
            const prices = {
                BTC: 50000, // Use your real-time prices if available
                ETH: 3000,
                XRP: 1
            };

            db.query(`
                SELECT u.username, u.balance +
                SUM(IF(p.crypto_symbol = 'BTC', p.quantity * ?, 
                       IF(p.crypto_symbol = 'ETH', p.quantity * ?, 
                       IF(p.crypto_symbol = 'XRP', p.quantity * ?, 0)))) AS portfolio_value
                FROM users u
                LEFT JOIN portfolios p ON u.user_id = p.user_id
                GROUP BY u.user_id
                ORDER BY portfolio_value DESC
                LIMIT 10`, [prices.BTC, prices.ETH, prices.XRP], (err, results) => {

                if (err) {
                    console.error("Error fetching leaderboard:", err);
                    bot.sendMessage(chatId, "An error occurred while fetching the leaderboard.");
                    return;
                }

                let leaderboardMessage = "🏆 Top 10 Users by Portfolio Value:\n\n";
                results.forEach((user, index) => {
                    leaderboardMessage += `${index + 1}. ${user.username}: $${user.portfolio_value.toFixed(2)}\n`;
                });

                bot.sendMessage(chatId, leaderboardMessage);
            });
            break;

        default:
            bot.sendMessage(chatId, "Unknown command.");
            break;
    }

    // Notify Telegram that the callback was processed
    bot.answerCallbackQuery(callbackQuery.id);
});
