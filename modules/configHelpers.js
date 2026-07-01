'use strict';

function getWarVoiceChannelId(config) {
    return config?.warVoiceChannelId || null;
}

function getProtectedVoiceChannelIds(config) {
    const raw = config?.protectedVoiceChannelIds || '';
    if (!raw) return [];
    return raw.split(',').map(id => id.trim()).filter(Boolean);
}

function isProtectedVoiceChannel(channelId, config) {
    if (!channelId) return false;
    return getProtectedVoiceChannelIds(config).includes(channelId);
}

module.exports = {
    getWarVoiceChannelId,
    getProtectedVoiceChannelIds,
    isProtectedVoiceChannel,
};
