const express = require('express');
const axios = require('axios');
const { pipeline } = require('@xenova/transformers');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// MongoDB Connection
const mongoUri = 'mongodb://localhost:27017';
const client = new MongoClient(mongoUri);
let db;

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db('sentiment_dashboard');
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
}
connectToMongo();

// Sentiment Analysis Pipeline
let classifier;
async function initClassifier() {
    classifier = await pipeline('sentiment-analysis', 'distilbert-base-uncased-finetuned-sst-2-english');
}
initClassifier();

// API Keys (Replace with your own)
const X_API_BEARER_TOKEN = 'YOUR_X_API_BEARER_TOKEN';
const NEWS_API_KEY = 'YOUR_NEWS_API_KEY';

// Fetch X Posts
async function fetchXPosts(asset) {
    try {
        const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
            headers: { Authorization: `Bearer ${X_API_BEARER_TOKEN}` },
            params: { query: `${asset} lang:en`, max_results: 10 },
        });
        return response.data.data.map(tweet => ({
            text: tweet.text,
            timestamp: new Date(tweet.created_at),
            source: 'X',
        }));
    } catch (error) {
        console.error('Error fetching X posts:', error.message);
        return [];
    }
}

// Fetch News Articles
async function fetchNewsArticles(asset) {
    try {
        const response = await axios.get('https://newsapi.org/v2/everything', {
            params: { q: asset, apiKey: NEWS_API_KEY, language: 'en', sortBy: 'publishedAt', pageSize: 10 },
        });
        return response.data.articles.map(article => ({
            text: article.title + ' ' + (article.description || ''),
            timestamp: new Date(article.publishedAt),
            source: 'News',
        }));
    } catch (error) {
        console.error('Error fetching news:', error.message);
        return [];
    }
}

// Analyze Sentiment
async function analyzeSentiment(text) {
    try {
        const result = await classifier(text);
        return result[0].label === 'POSITIVE' ? result[0].score : -result[0].score;
    } catch (error) {
        console.error('Sentiment analysis error:', error);
        return 0;
    }
}

// API Endpoint to Get Sentiment Data
app.get('/api/sentiment', async (req, res) => {
    const { asset } = req.query;
    if (!asset) {
        return res.status(400).json({ error: 'Asset parameter is required' });
    }

    try {
        const xPosts = await fetchXPosts(asset);
        const newsArticles = await fetchNewsArticles(asset);
        const allData = [...xPosts, ...newsArticles];

        const sentimentData = await Promise.all(
            allData.map(async (item) => ({
                score: await analyzeSentiment(item.text),
                timestamp: item.timestamp,
                source: item.source,
            }))
        );

        if (sentimentData.length > 0) {
            await db.collection('sentiment_data').insertMany(
                sentimentData.map(data => ({
                    asset,
                    ...data,
                    createdAt: new Date(),
                }))
            );
        }

        res.json(sentimentData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to process sentiment data' });
    }
});

// API Endpoint for Historical Data
app.get('/api/sentiment/history', async (req, res) => {
    const { asset, startDate, endDate } = req.query;
    try {
        const query = { asset };
        if (startDate && endDate) {
            query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }
        const historicalData = await db.collection('sentiment_data').find(query).toArray();
        res.json(historicalData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch historical sentiment data' });
    }
});

// Serve Landing Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});