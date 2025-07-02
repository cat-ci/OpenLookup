const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

const cache = new NodeCache({ stdTTL: 60 });

const router = express.Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeRead(file, fallback = null) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch {
        return fallback;
    }
}
async function safeWrite(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

let lastApiCall = 0;
async function rateLimitedFetch(url, label = '') {
    const now = Date.now();
    const wait = Math.max(0, 1500 - (now - lastApiCall));
    if (wait) {
        console.log(`[WAIT] Waiting ${wait}ms before ${label || url}`);
        await sleep(wait);
    }
    lastApiCall = Date.now();
    console.log(`[API] Fetching: ${url}`);
    return axios.get(url);
}

async function resolveVanity(url) {
    try {
        const resp = await axios.get(url, { maxRedirects: 0, validateStatus: null });
        if (resp.status === 302 && resp.headers.location) {
            return resp.headers.location;
        }
        return url;
    } catch {
        return url;
    }
}

router.get('/', async (req, res) => {
    const userInput = req.query.user;
    if (!userInput)
        return res.status(400).json({ error: 'Missing user parameter' });

    try {
        let idData = null;
        let steam64 = null;
        let steamDir = null;
        let isNewUser = false;

        if (/^\d{17}$/.test(userInput)) {
            steam64 = userInput;
            steamDir = `./steam/${steam64}`;
            idData = await safeRead(`${steamDir}/id.json`, null);
        } else {
            const steamRoot = './steam';
            let found = false;
            try {
                const userDirs = await fs.readdir(steamRoot);
                for (const dir of userDirs) {
                    const idPath = path.join(steamRoot, dir, 'id.json');
                    const data = await safeRead(idPath, null);
                    if (
                        data &&
                        (data.profileURL === userInput ||
                            data.profileURL.endsWith('/' + userInput + '/') ||
                            data.steamID === userInput ||
                            data.steam64 === userInput)
                    ) {
                        idData = data;
                        steam64 = data.steam64;
                        steamDir = path.join(steamRoot, dir);
                        found = true;
                        break;
                    }
                }
            } catch { }
            if (!found) {
                isNewUser = true;
            }
        }

        if (!idData) {
            const idResp = await axios.get(
                `http://localhost:${PORT}/findid?user=${encodeURIComponent(userInput)}`
            );
            idData = idResp.data;
            steam64 = idData.steam64;
            steamDir = `./steam/${steam64}`;
            await safeWrite(`${steamDir}/id.json`, idData);
            isNewUser = true;
        }

        idData.profilePermalink = `https://steamcommunity.com/profiles/${idData.steam64}/`;
        if (!idData.profileURL) idData.profileURL = idData.profilePermalink;

        let vanityChanged = false;
        if (idData.profileURL && idData.profileURL !== idData.profilePermalink) {
            const resolvedUrl = await resolveVanity(idData.profileURL);
            if (
                resolvedUrl !== idData.profilePermalink &&
                resolvedUrl !== idData.profileURL
            ) {
                idData.profileURL = resolvedUrl;
                await safeWrite(`${steamDir}/id.json`, idData);
                vanityChanged = true;
            }
        }

        let scrapeData = cache.get(`scrape_${steam64}`);
        if (!scrapeData) {
            const scrapeResp = await axios.get(
                `http://localhost:${PORT}/scrape?url=${encodeURIComponent(
                    idData.profilePermalink
                )}`
            );
            scrapeData = scrapeResp.data;
            cache.set(`scrape_${steam64}`, scrapeData);
            await safeWrite(`${steamDir}/scrape.json`, scrapeData);
        }

        let badgesData = await safeRead(`${steamDir}/badges.json`, null);
        let badgesChanged = false;
        const currBadgeCount = scrapeData?.sidePanel?.badges?.count || 0;
        if (!badgesData || badgesData.response?.badges?.length !== currBadgeCount) {
            try {
                const badgeResp = await rateLimitedFetch(
                    `https://api.steampowered.com/IPlayerService/GetBadges/v1/?key=${STEAM_API_KEY}&steamid=${steam64}`,
                    'GetBadges'
                );
                badgesData = badgeResp.data;
                await safeWrite(`${steamDir}/badges.json`, badgesData);
                badgesChanged = true;
            } catch (err) {
            }
        }

        let recentlyPlayed = await safeRead(
            `${steamDir}/recently-played.json`,
            null
        );
        let recentsChanged = false;
        if (
            !recentlyPlayed ||
            !recentlyPlayed.response ||
            !recentlyPlayed.response.games
        ) {
            recentsChanged = true;
        }
        if (recentsChanged) {
            try {
                const recentResp = await rateLimitedFetch(
                    `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${STEAM_API_KEY}&steamid=${steam64}&count=20`,
                    'GetRecentlyPlayedGames'
                );
                recentlyPlayed = recentResp.data;
                await safeWrite(`${steamDir}/recently-played.json`, recentlyPlayed);
            } catch (err) {
            }
        }

        let summaryData = await safeRead(`${steamDir}/summary.json`, {});
        let summaryFetchedThisCall = false;
        let avatarChanged = false;
        const prevAvatar = scrapeData?.profile?.avatar;
        let summaryPlayer = summaryData?.response?.players?.[0] || {};
        const currAvatar = summaryPlayer.avatarfull || scrapeData?.profile?.avatar;
        if (currAvatar && prevAvatar && currAvatar !== prevAvatar) {
            avatarChanged = true;
            if (!summaryFetchedThisCall) {
                try {
                    const summaryResp = await rateLimitedFetch(
                        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam64}`,
                        'GetPlayerSummaries'
                    );
                    summaryData = summaryResp.data;
                    summaryPlayer = summaryData?.response?.players?.[0] || {};
                    await safeWrite(`${steamDir}/summary.json`, summaryData);
                    summaryFetchedThisCall = true;
                } catch (err) {
                }
            }
        }

        let status = 'offline';
        let game = null;
        let scrapeStatus = scrapeData?.profile?.status || '';
        let scrapeGame = scrapeData?.profile?.game || null;

        if (scrapeStatus === 'in-game') {
            status = 'in-game';
            game = scrapeGame || summaryPlayer.gameextrainfo || null;
        } else if (scrapeStatus === 'online') {
            const lastCheck = cache.get(`summary_time_${steam64}`) || 0;
            if (Date.now() - lastCheck > 30 * 1000 && !summaryFetchedThisCall) {
                try {
                    const summaryResp = await rateLimitedFetch(
                        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam64}`,
                        'GetPlayerSummaries (status check)'
                    );
                    summaryData = summaryResp.data;
                    summaryPlayer = summaryData?.response?.players?.[0] || {};
                    await safeWrite(`${steamDir}/summary.json`, summaryData);
                    cache.set(`summary_time_${steam64}`, Date.now());
                    summaryFetchedThisCall = true;
                } catch (err) {
                }
            }
            const personaState = summaryPlayer.personastate;
            switch (personaState) {
                case 3:
                    status = 'away';
                    break;
                case 4:
                    status = 'snooze';
                    break;
                case 1:
                    status = 'online';
                    break;
                default:
                    status = 'online';
            }
        } else {
            status = 'offline';
        }

        const personaName =
            summaryPlayer.personaname ||
            scrapeData?.profile?.personaname ||
            idData.realName ||
            '';

        const avatars = {
            avatar: summaryPlayer.avatar || null,
            avatarmedium: summaryPlayer.avatarmedium || null,
            avatarfull: summaryPlayer.avatarfull || null,
            avatarhash: summaryPlayer.avatarhash || null,
            scraped: scrapeData?.profile?.avatar || null
        };

        const result = {
            steamid: steam64,
            profile: {
                name: personaName,
                realname: summaryPlayer.realname || idData.realName || '',
                avatars,
                avatarFrame: scrapeData?.profile?.avatarFrame || null,
                background: scrapeData?.profile?.backgroundImage || null,
                url: idData.profileURL,
                permalink: idData.profilePermalink,
                country: summaryPlayer.loccountrycode || idData.country || null,
                created: idData.accountCreated,
                level: scrapeData?.profile?.level || badgesData?.response?.player_level || null,
                levelStage: scrapeData?.profile?.levelStage || null,
                bio: scrapeData?.profile?.bio?.text || null,
                status,
                game,
            },
            stats: {
                games: scrapeData?.sidePanel?.stats?.games?.count || null,
                reviews: scrapeData?.sidePanel?.stats?.reviews?.count || null,
                screenshots: scrapeData?.sidePanel?.stats?.screenshots?.count || null,
                friends: scrapeData?.sidePanel?.friends?.count || null,
                groups: scrapeData?.sidePanel?.groups?.count || null,
            },
            badges: {
                count: scrapeData?.sidePanel?.badges?.count || 0,
                xp: badgesData?.response?.player_xp || 0,
                level: badgesData?.response?.player_level || 0,
                needed: badgesData?.response?.player_xp_needed_to_level_up || 0,
                favorite: scrapeData?.profile?.favoriteBadge || null,
                list: (badgesData?.response?.badges || []).map((b) => ({
                    badgeid: b.badgeid,
                    level: b.level,
                    xp: b.xp,
                    scarcity: b.scarcity,
                })),
            },
            awards: {
                count: scrapeData?.sidePanel?.awards?.count || 0,
                list: scrapeData?.sidePanel?.awards?.awards || [],
            },
            recentlyPlayed: {
                total: recentlyPlayed?.response?.total_count || 0,
                games: (recentlyPlayed?.response?.games || []).map((g) => ({
                    appid: g.appid,
                    name: g.name,
                    playtime_2weeks: g.playtime_2weeks,
                    playtime_forever: g.playtime_forever,
                })),
            },
            friends: (scrapeData?.sidePanel?.friends?.top || []).map((f) => ({
                name: f.name,
                url: f.link,
                avatar: f.avatar,
                level: f.level,
                status: f.status,
            })),
            groups: scrapeData?.sidePanel?.groups?.primary
                ? [
                    {
                        name: scrapeData.sidePanel.groups.primary.name,
                        url: scrapeData.sidePanel.groups.primary.link,
                        avatar: scrapeData.sidePanel.groups.primary.image,
                        members: scrapeData.sidePanel.groups.primary.members,
                    },
                ]
                : [],
            avatarChanged,
            badgeCountChanged: badgesChanged,
            vanityChanged,
            isNewUser,
        };

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;