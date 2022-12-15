const express = require('express');
const app = express();

app.use(
    express.urlencoded({extended: true}),
    express.json()
);

const fs = require("fs");
const Web3 = require('web3');
const opensea = require('opensea-js');
const HDWalletProvider = require("@truffle/hdwallet-provider");

require('dotenv').config();

const ERC721ABI = JSON.parse(fs.readFileSync(process.env.ERC721_ABI_PATH).toString());


async function approveIfNotApproved(network, tokenAddress, address, provider) {
    const web3 = new Web3(provider);
    const contract = new web3.eth.Contract(ERC721ABI, tokenAddress);
    const openseaAddress = {
        'mainnet': process.env.MAINNET_OPENSEA_ADDRESS,
        'rinkeby': process.env.RINKEBY_OPENSEA_ADDRESS
    }[network];

    console.log(`[${address} | ${network}] Checking approval for ${openseaAddress}`);

    if (!await contract.methods.isApprovedForAll(address, openseaAddress).call()) {
        console.log(`[${address} | ${network}] Token wasn't approved. Approving...`);
        await contract.methods.setApprovalForAll(openseaAddress, true).send({from: provider.getAddress()});
        console.log(`[${address} | ${network}] Done.`);
    } else {
        console.log(`[${address} | ${network}] Token was approved. Proceeding...`);
    }
}

async function checkFunds(network, address, price, provider) {
    const web3 = new Web3(provider);
    const balance = parseInt(await web3.eth.getBalance(address));

    return balance >= price;
}

async function getProvider(mnemonic, network) {
    return new HDWalletProvider({
        mnemonic: mnemonic,
        providerOrUrl: `https://${network}.infura.io/v3/${process.env.INFURA_API_KEY}`,
    });
}

async function getSeaPort(provider, network) {
    if (network === "mainnet") {
        return new opensea.OpenSeaPort(provider, {
            networkName: opensea.Network.Main,
            apiKey: process.env.OPENSEA_API_KEY
        });
    } else if (network === "rinkeby") {
        return new opensea.OpenSeaPort(provider, {
            networkName: opensea.Network.Rinkeby
        });
    } else {
        return null;
    }
}


app.get('/', (req, res) => {
    res.send('Server is running.');
})

app.post('/sell', async (req, res) => {
    console.log('received POST on /sell');
    console.log(req.body);

    if (req.body['password'] === process.env.ACCESS_KEY) {
        let mnemonic = req.body['mnemonic'];
        let network = req.body['network'];

        let seller = req.body['seller'];
        let tokenId = parseInt(req.body['tokenId']);
        let tokenAddress = req.body['tokenAddress'];
        let startAmount = parseFloat(req.body['startAmount']);

        let provider = await getProvider(mnemonic, network);
        let seaport = await getSeaPort(provider, network);

        try {
            await approveIfNotApproved(network, tokenAddress, seller, provider);

            console.log(`[${seller} | ${network}] Trying to create an offer for NFT ${tokenId}...`);

            try {
                const offer = await seaport.createSellOrder({
                    asset: {
                        tokenId: tokenId,
                        tokenAddress: tokenAddress,
                        schemaName: "ERC721",
                    },
                    accountAddress: seller,
                    startAmount: startAmount
                })

                console.log(`[${seller} | ${network}] Offer created successfully, expiration time: ${offer.expirationTime}`);

                res.send({"result": offer.expirationTime})
            } catch (err) {
                console.log(err)
                console.log(`[${seller} | ${network}] Trying again...`)
                await new Promise(r => setTimeout(r, 3000));

                try {
                    const offer = await seaport.createSellOrder({
                        asset: {
                            tokenId: tokenId,
                            tokenAddress: tokenAddress,
                            schemaName: "ERC721",
                        },
                        accountAddress: seller,
                        startAmount: startAmount
                    })

                    console.log(`[${seller} | ${network}] Offer created successfully, expiration time: ${offer.expirationTime}`);

                    res.send({"result": offer.expirationTime})
                } catch (err) {
                    console.log(err)
                    console.log(`[${seller} | ${network}] Error persists. IDK what to do next`)
                    res.send({"result": err})
                }
            }


        } catch (error) {
            console.log(error)
            res.statusMessage = error;
            res.status(400).end();
        }
    } else {
        res.send({"result": "Unauthorised"});
    }
})

app.post('/buy', async (req, res) => {
    console.log('received POST on /buy');
    console.log(req.body);

    if (req.body['password'] === process.env.ACCESS_KEY) {
        let mnemonic = req.body['mnemonic'];
        let network = req.body['network'];

        let buyer = req.body['buyer'];
        let tokenId = parseInt(req.body['tokenId']);
        let tokenAddress = req.body['tokenAddress'];

        let provider = await getProvider(mnemonic, network);
        let seaport = await getSeaPort(provider, network);

        try {
            const order = await seaport.api.getOrder({
                side: "ask",
                tokenIds: [tokenId],
                assetContractAddress: tokenAddress,
                protocol: "seaport"
            })

            if (await checkFunds(network, buyer, parseInt(order.currentPrice), provider)) {
                const transactionHash = await seaport.fulfillOrder({ order, buyer })
                console.log(`transaction was successful: ${transactionHash}`)
                res.send({"result": transactionHash})
            } else {
                console.log(`transaction wasn't successful!`)
                res.statusMessage = `Funds on wallet ${buyer} are insufficient for buying NFT ${tokenId} (${order.currentPrice} ETH)`;
                res.status(400).end();
            }
        } catch (error) {
            console.log(`transaction wasn't successful! ${error}`)
            res.statusMessage = error;
            res.status(400).end();
        }
    } else {
        res.send({"result": "Unauthorised"});
    }
})

app.listen(7777, () => console.log('API is ready. v 0.0.1'));
