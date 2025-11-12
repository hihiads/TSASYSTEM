const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const activeTracks = new Map();
const invites = new Map();
const warnings = new Map(); // { userId: [{ moderator, reason, date }] }
const allowedUsers = ['1241862272234688523', '990626592474677349', '1436771975048462398'];
const prefix = "$";

/* =========================== READY =========================== */
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  client.guilds.cache.forEach(async guild => {
    const guildInvites = await guild.invites.fetch().catch(() => null);
    if (guildInvites) invites.set(guild.id, guildInvites);
  });

  client.user.setPresence({ activities: [{ name: 'dsc.gg/supremeslime', type: 4 }], status: 'idle' });
});

/* =========================== VERIFY SYSTEM =========================== */
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.name !== 'verify') return;

  if (message.content.toLowerCase() === '.verify') {
    const role = message.guild.roles.cache.get('1437373036557766706'); // Change role ID
    if (!role) return message.reply('❌ Role not found.');
    try {
      await message.member.roles.add(role);
      
    } catch (err) {
      console.error(err);
      message.reply('❌ Failed to verify you.');
    }
  }
});

/* =========================== WELCOME + INVITE TRACKING =========================== */
client.on('guildMemberAdd', async member => {
  const welcomeChannel = member.guild.channels.cache.find(ch => ch.name.includes('welcome'));
  if (welcomeChannel) welcomeChannel.send(`👋 Welcome ${member} to the server!`);

  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites.get(i.code)?.uses || 0));

    if (invite) {
      const logChannel = member.guild.channels.cache.find(ch => ch.name.includes('logs'));
      if (logChannel) logChannel.send(`${member.user.tag} joined using invite code **${invite.code}** created by **${invite.inviter.tag}**.`);
    }

    invites.set(member.guild.id, newInvites);
  } catch (err) {
    console.error('Invite tracking error:', err);
  }
});

/* =========================== COMMAND HANDLER =========================== */
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args[0]?.toLowerCase();

  // Permission check
  if (['.track', '.ban', '.unban', '.kick', '.mute', '.unmute', '.warn'].includes(command) && !allowedUsers.includes(message.author.id)) {
    return message.reply('🚫 You are not allowed to use this command.');
  }

  /* =========================== TRACK SYSTEM ============================ */
  if (command === '.track') {
    const targetUser = message.mentions.users.first();
    if (args[1] === 'off') {
      if (!activeTracks.get(message.guild.id)) return message.reply('No active tracking to stop!');
      activeTracks.delete(message.guild.id);
      return message.reply('Tracking stopped.');
    }
    if (!targetUser) return message.reply('Please mention a user to track.');

    const member = message.guild.members.cache.get(targetUser.id);
    if (!member) return message.reply('User not in server.');

    await message.reply('Please mention the channel where you want to track the user status (e.g. #general).');
    const filter = m => m.author.id === message.author.id && m.mentions.channels.first();
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
    if (!collected.size) return message.reply('No channel mentioned, cancelled.');

    const channel = collected.first().mentions.channels.first();
    const embed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle(`Tracking ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'Status', value: member.presence?.status || 'offline', inline: true },
        { name: 'Activity', value: getActivities(member.presence), inline: true }
      )
      .setFooter({ text: `Tracking started by ${message.author.tag}` });

    const trackingMessage = await channel.send({ embeds: [embed] });
    activeTracks.set(message.guild.id, { userId: targetUser.id, channelId: channel.id, messageId: trackingMessage.id });

    message.reply(`Now tracking ${targetUser.tag} in ${channel}. To stop, type \`.track off\``);
  }

  /* =========================== KICK / BAN / UNBAN ============================ */
  if (command === '.kick') {
    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a user to kick.');
    target.send(`👢 You have been kicked from **${message.guild.name}** by ${message.author.tag}`).catch(() => null);
    await target.kick('Manual kick').catch(() => null);
    message.reply(`👢 ${target.user.tag} has been kicked.`);
    sendLog(message.guild, `👢 ${target.user.tag} was kicked by ${message.author.tag}`);
  }

  if (command === '.ban') {
    const targetID = args[1];
    if (!targetID) return message.reply('Please provide a user ID to ban.');
    try {
      const user = await client.users.fetch(targetID);
      user.send(`⛔ You have been banned from **${message.guild.name}** by ${message.author.tag}`).catch(() => null);
    } catch {}
    await message.guild.members.ban(targetID, { reason: 'Manual ban' }).catch(() => null);
    message.reply(`⛔ User with ID ${targetID} has been banned.`);
    sendLog(message.guild, `⛔ User with ID ${targetID} was banned by ${message.author.tag}`);
  }

  if (command === '.unban') {
    const targetID = args[1];
    if (!targetID) return message.reply('Please provide a user ID to unban.');
    await message.guild.bans.remove(targetID).catch(() => null);
    message.reply(`✅ User with ID ${targetID} has been unbanned.`);
    sendLog(message.guild, `✅ User with ID ${targetID} was unbanned by ${message.author.tag}`);
  }
/* =========================== messageCreate ============================ */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, userId] = interaction.customId.split('_');
  const guild = interaction.guild;
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!allowedUsers.includes(interaction.user.id)) {
    return interaction.reply({ content: '🚫 You are not allowed to use this button.', ephemeral: true }).catch(() => {});
  }

  if (!member) return interaction.reply({ content: '❌ User not found or has left the server.', ephemeral: true }).catch(() => {});

  // Helper za sigurni reply
  async function safeReply(content) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }

  switch (action) {
    case 'ban':
      await member.send(`⛔ You have been banned from **${guild.name}** by staff.`).catch(() => {});
      await guild.members.ban(member.id, { reason: 'Reached 3 warnings' }).catch(() => {});
      await safeReply(`⛔ ${member.user.tag} has been banned.`);
      sendLog(guild, `⛔ ${member.user.tag} was banned after 3 warnings.`);
      break;

    case 'kick':
      await member.send(`👢 You have been kicked from **${guild.name}** by staff.`).catch(() => {});
      await member.kick('Reached 3 warnings').catch(() => {});
      await safeReply(`👢 ${member.user.tag} has been kicked.`);
      sendLog(guild, `👢 ${member.user.tag} was kicked after 3 warnings.`);
      break;

    case 'mute':
      const muteRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('mute'));
      if (!muteRole) return safeReply('⚠️ No mute role found.');
      await member.roles.add(muteRole).catch(() => {});
      await member.send(`🔇 You have been muted in **${guild.name}** by staff.`).catch(() => {});
      await safeReply(`🔇 ${member.user.tag} has been muted.`);
      sendLog(guild, `🔇 ${member.user.tag} was muted after 3 warnings.`);
      break;

    case 'none':
      await safeReply(`✅ No action taken for ${member.user.tag}.`);
      sendLog(guild, `✅ No action taken for ${member.user.tag} after 3 warnings.`);
      break;
  }

  // Disable buttons
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ban_disabled`).setLabel('Ban').setStyle(ButtonStyle.Danger).setDisabled(true),
    new ButtonBuilder().setCustomId(`kick_disabled`).setLabel('Kick').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`mute_disabled`).setLabel('Mute').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`none_disabled`).setLabel('Do Nothing').setStyle(ButtonStyle.Success).setDisabled(true)
  );

  await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
});

  /* =========================== WARN SYSTEM ============================ */
  if (command === '.warn') {
  const target = message.mentions.members.first();
  if (!target) return message.reply('Please mention a user to warn.');
  const reason = args.slice(2).join(' ') || 'No reason provided';

  if (!warnings.has(target.id)) warnings.set(target.id, []);
  warnings.get(target.id).push({ moderator: message.author.tag, reason, date: new Date().toLocaleString() });

  message.reply(`⚠️ ${target.user.tag} has been warned: ${reason}`);
  sendLog(message.guild, `⚠️ ${target.user.tag} was warned by ${message.author.tag} | Reason: ${reason}`);
  target.send(`⚠️ You have been warned in **${message.guild.name}** by ${message.author.tag}. Reason: ${reason}`).catch(() => null);

  const userWarnings = warnings.get(target.id).length;

  if (userWarnings === 3) {
    const staffChannel = message.guild.channels.cache.find(ch => ch.name.includes('staff-lounge'));
    if (!staffChannel) return;

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('⚠️ User Reached 3 Warnings!')
      .setDescription(`User: **${target.user.tag}** (${target.id})\nModerator: **${message.author.tag}**`)
      .addFields({ name: 'Last Reason', value: reason })
      .setFooter({ text: 'Choose an action below:' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ban_${target.id}`).setLabel('Ban').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`kick_${target.id}`).setLabel('Kick').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`mute_${target.id}`).setLabel('Mute').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`none_${target.id}`).setLabel('Do Nothing').setStyle(ButtonStyle.Success)
    );

    staffChannel.send({ embeds: [embed], components: [row] });
  }
}


  /* =========================== ANTI-SPAM ============================ */
  if (!message.author.bot) {
    const spamThreshold = 5; // max messages per 5 sec
    if (!client.spamCache) client.spamCache = new Map();
    const now = Date.now();
    const userData = client.spamCache.get(message.author.id) || { count: 0, lastMessage: now };
    
    if (now - userData.lastMessage < 5000) {
      userData.count += 1;
      if (userData.count >= spamThreshold) {
        await message.delete().catch(() => {});
        if (!warnings.has(message.author.id)) warnings.set(message.author.id, []);
        warnings.get(message.author.id).push({ moderator: 'Anti-Spam', reason: 'Spamming', date: new Date().toLocaleString() });
        message.author.send(`⚠️ You have been warned for spamming in **${message.guild.name}**`).catch(() => null);
      }
    } else {
      userData.count = 1;
    }

    userData.lastMessage = now;
    client.spamCache.set(message.author.id, userData);
  }
});

/* =========================== PRESENCE UPDATE (TRACK) =========================== */
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  const guildId = newPresence.guild.id;
  const trackData = activeTracks.get(guildId);
  if (!trackData) return;
  if (newPresence.userId !== trackData.userId) return;

  const guild = newPresence.guild;
  const trackChannel = guild.channels.cache.get(trackData.channelId);
  if (!trackChannel) return;

  try {
    const msg = await trackChannel.messages.fetch(trackData.messageId);
    const member = guild.members.cache.get(newPresence.userId);
    const updatedEmbed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle(`Tracking ${member.user.tag}`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'Status', value: newPresence.status || 'offline', inline: true },
        { name: 'Activity', value: getActivities(newPresence), inline: true }
      )
      .setFooter({ text: 'Tracking updated' });

    msg.edit({ embeds: [updatedEmbed] });
  } catch (err) {
    console.error('Failed to update tracking message:', err);
  }
});

/* =========================== HELPERS =========================== */
function getActivities(presence) {
  if (!presence || !presence.activities.length) return 'None';
  return presence.activities.map(a => a.name).join(', ');
}

function sendLog(guild, text) {
  const logChannel = guild.channels.cache.find(ch => ch.name.includes('logs'));
  if (logChannel) logChannel.send(text);
}




client.login(process.env.token);
