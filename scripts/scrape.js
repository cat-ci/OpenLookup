const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const PORT = process.env.PORT || 3000;
const router = express.Router();

router.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const profile = {};

        const staticBgEl = $('.has_profile_background[style]');
        if (staticBgEl.length) {
            const style = staticBgEl.attr('style') || '';
            const bgMatch = style.match(
                /background-image\s*:\s*url\(\s*['"]?(.*?)['"]?\s*\)/
            );
            if (bgMatch) {
                profile.backgroundImage = bgMatch[1];
            }
        }

        const animatedBgEl = $('.profile_animated_background');
        if (animatedBgEl.length) {
            const videoEl = animatedBgEl.find('video');
            const poster = videoEl.attr('poster') || null;
            const sources = [];
            videoEl.find('source').each((i, srcEl) => {
                const src = $(srcEl).attr('src');
                const type = $(srcEl).attr('type');
                if (src && type) {
                    sources.push({ src, type });
                }
            });
            if (poster || sources.length) {
                profile.animatedBackground = { poster, sources };
            }
        }

        const avatarContainer = $('.playerAvatarAutoSizeInner');
        if (avatarContainer.length) {
            const frameImg = avatarContainer.find('.profile_avatar_frame img').attr('src') || null;
            let avatarImg = null;
            avatarContainer.children('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src) avatarImg = src;
            });
            profile.avatar = avatarImg;
            profile.avatarFrame = frameImg;
        }

        const levelEl = $('.friendPlayerLevel');
        if (levelEl.length) {
            const levelNum = levelEl.find('.friendPlayerLevelNum').text().trim();
            profile.level = levelNum || null;
            const classList = (levelEl.attr('class') || '').split(/\s+/);
            const stageClass = classList.find((c) => c.startsWith('lvl_'));
            profile.levelStage = stageClass || null;
        }

        const favBadgeEl = $('a.favorite_badge');
        if (favBadgeEl.length) {
            const link = favBadgeEl.attr('href') || null;
            const image = favBadgeEl.find('.favorite_badge_icon img').attr('src') || null;
            const name = favBadgeEl.find('.favorite_badge_description .name').text().trim() || null;
            const xp = favBadgeEl.find('.favorite_badge_description .xp').text().trim() || null;
            profile.favoriteBadge = { link, image, name, xp };
        }

        const bioEl = $('.profile_summary');
        if (bioEl.length) {
            const raw = bioEl.html().trim();

            let text = '';
            bioEl.contents().each((i, el) => {
                if (el.type === 'text') {
                    text += $(el).text();
                } else if (el.name === 'img' && $(el).hasClass('emoticon')) {
                    text += $(el).attr('alt') || '';
                } else {
                    text += $(el).text();
                }
            });
            profile.bio = { raw, text: text.trim() };
        }

        let status = null;
        let game = null;
        let joinGameLink = null;
        const statusEl = $(
            '.profile_in_game, .profile_in_nonsteam_game, .profile_in_game_header, .profile_in_nonsteam_game_header, .profile_online, .profile_offline, .profile_away, .profile_busy, .profile_snooze'
        );
        if (statusEl.length) {
            if (statusEl.hasClass('in-game') || statusEl.hasClass('in_nonsteam_game')) {
                status = 'in-game';
                const gameName = statusEl.find('.profile_in_game_name').text().trim();
                game = gameName || null;
                const joinLink = statusEl.find('.profile_in_game_joingame a').attr('href');
                joinGameLink = joinLink || null;
            } else if (statusEl.hasClass('online')) {
                status = 'online';
            } else if (statusEl.hasClass('offline')) {
                status = 'offline';
            } else if (statusEl.hasClass('away')) {
                status = 'away';
            } else if (statusEl.hasClass('busy')) {
                status = 'busy';
            } else if (statusEl.hasClass('snooze')) {
                status = 'snooze';
            }
        }
        profile.status = status;
        profile.game = game;
        profile.joinGameLink = joinGameLink;

        const sidePanel = {};

        const awardsSection = $('.profile_awards');
        if (awardsSection.length) {
            const awardsLink = awardsSection.find('.profile_count_link a');
            const awardsCount = parseInt(
                awardsSection.find('.profile_count_link_total').text().trim()
            ) || 0;
            const awards = [];
            awardsSection.find('.profile_badges_badge').each((i, el) => {
                const img = $(el).find('img').attr('src') || null;
                const tooltip = $(el).attr('data-tooltip-html') || '';
                const name = tooltip.split('<br>')[0].replace(/(<([^>]+)>)/gi, '').trim();
                awards.push({ image: img, name });
            });
            sidePanel.awards = {
                link: awardsLink.attr('href') || null,
                count: awardsCount,
                awards
            };
        }

        const badgesSection = $('.profile_badges');
        if (badgesSection.length) {
            const badgesLink = badgesSection.find('.profile_count_link a');
            const badgesCount = parseInt(
                badgesSection.find('.profile_count_link_total').text().trim()
            ) || 0;
            const badges = [];
            badgesSection.find('.profile_badges_badge').each((i, el) => {
                const img = $(el).find('img').attr('src') || null;
                const link = $(el).find('a').attr('href') || null;
                const tooltip = $(el).attr('data-tooltip-html') || '';
                // Name is first line, level is second line if present
                const tooltipLines = tooltip.split('<br>');
                const name = tooltipLines[0].replace(/(<([^>]+)>)/gi, '').trim();
                const level = tooltipLines[1]
                    ? tooltipLines[1].replace(/(<([^>]+)>)/gi, '').trim()
                    : null;
                badges.push({ image: img, name, level, link });
            });
            sidePanel.badges = {
                link: badgesLink.attr('href') || null,
                count: badgesCount,
                badges
            };
        }

        sidePanel.stats = {};
        $('.profile_item_links .profile_count_link').each((i, el) => {
            const linkEl = $(el).find('a');
            const name = linkEl.find('.count_link_label').text().trim();
            let count = linkEl.find('.profile_count_link_total').text().trim();
            count = count && !/^\s*&nbsp;\s*$/.test(count) ? parseInt(count) || 0 : 0;
            const link = linkEl.attr('href') || null;
            if (name) {
                sidePanel.stats[name.toLowerCase().replace(/\s+/g, '_')] = {
                    name,
                    count,
                    link
                };
            }
        });

        const groupsSection = $('.profile_group_links');
        if (groupsSection.length) {
            const groupLink = groupsSection.find('.profile_count_link a');
            const groupCount = parseInt(
                groupsSection.find('.profile_count_link_total').text().trim()
            ) || 0;
            const primaryGroup = groupsSection.find('.profile_primary_group');
            let groupPreview = null;
            if (primaryGroup.length) {
                groupPreview = {
                    name: primaryGroup.find('.whiteLink').text().trim(),
                    link: primaryGroup.find('.whiteLink').attr('href') || null,
                    image: primaryGroup.find('.profile_group_avatar img').attr('src') || null,
                    members: primaryGroup.find('.profile_group_membercount').text().trim()
                };
            }
            sidePanel.groups = {
                link: groupLink.attr('href') || null,
                count: groupCount,
                primary: groupPreview
            };
        }

        const friendsSection = $('.profile_friend_links');
        if (friendsSection.length) {
            const friendsLink = friendsSection.find('.profile_count_link a');
            const friendsCount = parseInt(
                friendsSection.find('.profile_count_link_total').text().trim()
            ) || 0;
            const topFriends = [];
            friendsSection.find('.profile_topfriends .friendBlock').each((i, el) => {
                const friend = $(el);
                const name = friend.find('.friendBlockContent').contents().first().text().trim();
                const link = friend.find('.friendBlockLinkOverlay').attr('href') || null;
                const avatar = friend.find('.playerAvatar img').attr('src') || null;
                const level = friend.find('.friendPlayerLevelNum').text().trim() || null;
                const levelStage = (friend.find('.friendPlayerLevel').attr('class') || '')
                    .split(/\s+/)
                    .find((c) => c.startsWith('lvl_')) || null;
                const status = friend.find('.friendSmallText').text().trim();
                topFriends.push({ name, link, avatar, level, levelStage, status });
            });
            sidePanel.friends = {
                link: friendsLink.attr('href') || null,
                count: friendsCount,
                top: topFriends
            };
        }

        let total = null;
        const totalDiv = $('.recentgame_quicklinks.recentgame_recentplaytime > div').first();
        if (totalDiv.length) {
            const totalText = totalDiv.text().trim();
            const match = totalText.match(/([\d.]+ hours?)/i);
            total = match ? match[1] : totalText;
        }

        const games = [];
        $('.recent_game').each((i, el) => {
            const game = $(el);

            const title = game.find('.game_name a').text().trim();

            const detailsHtml = game.find('.game_info_details').html() || '';
            const playTimeMatch = detailsHtml.match(/([\d.]+ hrs) on record/);
            const playTime = playTimeMatch ? playTimeMatch[1] : null;
            const lastPlayedMatch = detailsHtml.match(/last played on ([\d\w\s]+)/i);
            const lastPlayed = lastPlayedMatch ? lastPlayedMatch[1].trim() : null;

            const achievements = game
                .find('.game_info_achievement_summary .ellipsis')
                .text()
                .split(' ')[0]
                .trim();

            const thumbnail = game.find('.game_capsule').attr('src') || null;

            let badge = null;
            const badgeEl = game.find('.game_info_badge');
            if (badgeEl.length) {
                const badgeName = badgeEl.find('.name a').text().trim();
                const badgeXP = badgeEl.find('.xp').text().replace('XP', '').trim();
                const badgeImage = badgeEl.find('img.badge_icon').attr('src');
                const foil = /foil/i.test(badgeName) ? 'y' : 'n';
                badge = {
                    name: badgeName,
                    level: badgeXP,
                    image: badgeImage,
                    foil
                };
            }

            games.push({
                title,
                'play-time': playTime,
                'last-played': lastPlayed,
                achievements,
                thumbnail,
                badge
            });
        });

        const result = {
            profile,
            sidePanel,
            'recently-played': {
                total,
                'recent-games': { games }
            }
        };

        return res.json(result);
    } catch (err) {
        return res
            .status(500)
            .json({ error: 'Failed to scrape the page', details: err.message });
    }
});


module.exports = router;