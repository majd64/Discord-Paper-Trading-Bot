//v1.0.0.
const Discord = require('discord.js');
const axios = require('axios');
require('custom-env').env('staging');
let models = require("./models");
const mongoose = require("mongoose");
const util = require("./util");

const client = new Discord.Client();
client.login(process.env.LOGIN);
client.once('ready', () => {
  console.log("Paper Trading Bot is running");
});

mongoose.connect("mongodb+srv://admin:" + process.env.ATLASPASSWORD + "@cluster0.xpbd4.mongodb.net/" + process.env.ATLASUSER, {useNewUrlParser: true, useUnifiedTopology: true});

const formatter = new Intl.NumberFormat('en-US', {style: 'currency',currency: "USD",minimumFractionDigits: 5});

const prefix = "!";
const color = "#9b59b6"

client.on ('message', async message => {
  if (!message.content.startsWith(prefix)) return

  var user = await models.User.findOne({'id': message.author.id}).exec();
  if (user == null){
    const newUser = new models.User({
      id: message.author.id,
      username: message.author.username,
      usdbalance: 10000,
      wallet: [],
      openOrder: undefined,
      orderHistory: []
    });
    user = newUser;
  }

  user.username = message.author.username
  await user.save();

  const args = message.content.slice(prefix.length).split(" ");
  const command = args.shift().toLowerCase();

  if (command === "price"){
    let p = await price(args[0]);
    message.channel.send(p ? formatter.format(p) : "Invalid symbol")
  }

  else if (command === "buy"){
    createOrder("marketbuy", user, args, message)
  }

  else if (command === "sell"){
    createOrder("marketsell", user, args, message)
  }

  else if (command === "yes"){
    let order = user.openOrder
    if (!user.openOrder.amount) return message.channel.send("No open orders")

    if (order.date < (Math.round(Date.now() / 1000) - 60)){
      user.openorder = undefined
      return message.channel.send("Order expired")
    }

    if (order.order === "marketbuy"){
      if (order.amount * order.price > user.usdbalance) return message.channel.send("Not enough funds")
      user.usdbalance = user.usdbalance - order.amount * order.price
      const index = user.wallet.findIndex(x => x.symbol === order.symbol)
      index === -1 ? (user.wallet.push({symbol: order.symbol, amount: order.amount})) : (user.wallet[index].amount += order.amount)
    }

    else if (order.order === "marketsell"){
      const index = user.wallet.findIndex(x => x.symbol === order.symbol)
      coin = user.wallet[index]
      if (order.amount === -1) order.amount = coin.amount
      if (order.amount > coin.amount) return message.channel.send("Not enough funds")
      user.usdbalance = user.usdbalance + (order.amount * order.price)
      user.wallet[index].amount = user.wallet[index].amount - order.amount
      if (user.wallet[index].amount === 0) user.wallet.splice(index, 1);
    }

    user.orderHistory.push(user.openOrder)
    user.openOrder = undefined
    await user.save();
    message.channel.send("Success!")
  }

  else if (command === "no"){
    user.openOrder = undefined
    await user.save();
    message.channel.send("Order canclled")
  }

  else if (command === "wallet"){
    var itemsImbed = new Discord.MessageEmbed()

    let wallet = await values(user.wallet)
    itemsImbed
    .setColor(color)
    .addField("Total wallet value", formatter.format(wallet.total + user.usdbalance))
    .addField("USD", formatter.format(user.usdbalance));

    wallet.wallet.forEach((coin, j) => {
      itemsImbed.addField(`${coin.symbol}`, `Amount: ${coin.amount}\n value: ${formatter.format(coin.amount * coin.price)}`);
    });
    message.channel.send(itemsImbed)
  }

  else if (command === "history"){
    var itemsImbed = new Discord.MessageEmbed().setColor(color)
    user.orderHistory.forEach((order, j) => {
      var string = ""
      itemsImbed.addField(`${order.order === "marketbuy" ? "Buy" : "Sell"} ${order.symbol}`, `Price: ${order.price}\nAmount: ${order.amount}\nTotal: ${order.price * order.amount}`);
      if(itemsImbed.fields.length === 25){
        message.channel.send(itemsImbed);
        itemsImbed = new Discord.MessageEmbed().setColor(color);
      }
    });
    message.channel.send(itemsImbed);
  }

  else if (command === "leaderboard" || command === "leaderboards" || command === "score" || command === "board"){
    let leaderboard = [];
    var lowestBal;
    var lowestBalIndex = -1;
    await models.User.find({}, async (err, users) => {
      users.forEach(async (user, i) => {
        if (leaderboard.length < 10){
          let vals = await values(user.wallet)
          leaderboard.push({username: user.username, id: user.id, total: vals.total + user.usdbalance})
        }else{
          leaderboard.sort((a, b) => parseFloat(a.total) - parseFloat(b.total));
        }
        if (leaderboard.length >= users.length){
          leaderboard.sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
          var itemsImbed = new Discord.MessageEmbed().setColor(color)
          itemsImbed.addField(`Total number of users`, `${leaderboard.length}`);

          for (let i = 0; i < 10; i++){
            itemsImbed.addField(`${i + 1}) ${leaderboard[i].username ? leaderboard[i].username : "Username not stored yet"}`, `${formatter.format(leaderboard[i].total)}`);
          }
          message.channel.send(itemsImbed)
        }
      });
    })
  }

  else if (command === "help"){
    const fields = [{ name: '!price [symbol]', value: "Returns price of a coin", inline: false},
    { name: '!wallet', value: "Shows wallet value, balance and all coins", inline: false},
    { name: '!buy [symbol] [amount]', value: "Buys a coin (use 'max' to buy using your entire balance)", inline: false},
    { name: '!sell [symbol] [amount]', value: "Sells a coin  (use 'max' to sell your entire balance)", inline: false},
    { name: '!history', value: "Shows trade history", inline: false},
    { name: '!leaderboard', value: "Shows top 10 richest users", inline: false}]

    const helpEmbed = new Discord.MessageEmbed()
    .setColor(color)
    helpEmbed.fields = fields;
    message.channel.send(helpEmbed)
  }
});

async function createOrder(orderType, user, args, message){
  user.openOrder = undefined;

  const input = util.parseInput(args)
  if (!input) return message.channel.send(`Invalid input. To buy use the command *${prefix}buy 100 ada*`)
  input.symbol = input.symbol.toUpperCase()
  if (input.symbol.includes("UP") || input.symbol.includes("DOWN")) return message.channel.send(`No leveraged assets allowed!`)

  let p = await price(input.symbol);
  if (!p) return message.channel.send("Invalid symbol")

  let index;

  if (orderType === "marketsell"){
    index = await user.wallet.findIndex(x => x.symbol.toUpperCase() === input.symbol.toUpperCase())
    if (index === -1) return message.channel.send(`You have no ${input.symbol}`)
  }

  if (input.amount === -1) orderType === "marketbuy" ? (input.amount = user.usdbalance / p) : (input.amount = user.wallet[index].amount)

  user.openOrder = {order: orderType, symbol: input.symbol, amount: input.amount, price: p, date: Math.round(Date.now() / 1000)}
  user.save();
  return message.channel.send(`Are you sure you want to ${orderType === "marketbuy" ? "buy" : "sell"} ${input.amount} ${input.symbol}? Price of ${input.symbol} is ${formatter.format(p)}. Total will be ${formatter.format(p * input.amount)}. (${prefix}yes or ${prefix}no)`)
}

const price = symbol => {
  return new Promise((resolve, reject) => {
    axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}USDT`)
      .then(res => {
        if (!res.data.price){
          axios.get(`https://api.kucoin.com/api/v1/prices?currencies=${symbol.toUpperCase()}`)
            .then(res => {
              if (!res.data.data[symbol.toUpperCase()]){
                return resolve(null)
              }
              resolve(res.data.data[symbol.toUpperCase()])
            })
            .catch(err => {
              return resolve(null)
            })
        }
        resolve(res.data.price)
      })
      .catch(err => {
        axios.get(`https://api.kucoin.com/api/v1/prices?currencies=${symbol.toUpperCase()}`)
          .then(res => {
            if (!res.data.data[symbol.toUpperCase()]){
              return resolve(null)
            }
            resolve(res.data.data[symbol.toUpperCase()])
          })
          .catch(err => {
            return resolve(null)
          })
      })
  })
}

const values = async wallet => {
  return new Promise(async (resolve, reject) => {
    const newWallet = JSON.parse(JSON.stringify(wallet));
    var total = 0;
    let counter = 0;
    if (newWallet.length === 0) return resolve({wallet: [], total: total})

    newWallet.forEach(async (coin, i) => {
      let p = await price(coin.symbol)
      counter += 1
      newWallet[i].price = p
      total = total + (parseFloat(p) * coin.amount)
      if (counter == newWallet.length) return resolve({wallet: newWallet, total: total})
    });
  })
}
