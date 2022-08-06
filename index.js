const { Client, GatewayIntentBits, ApplicationCommandOptionType, InteractionType } = require("discord.js");
const { AudioPlayer, createAudioResource, StreamType, entersState, VoiceConnectionStatus, joinVoiceChannel } = require("@discordjs/voice");

const cheerio = require("cheerio");
const { exec } = require('child_process');
const { Stream } = require("stream");
const { getAllAudioBase64, getAudioBase64 } = require("google-tts-api");
const { default: axios } = require("axios");

require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages] });
client.login(process.env.BOT_TOKEN);

client.on("ready", () => {
    var commands = [
        {
            name: "random-lyrics-ai", description: "randomly generate lyrics by an AI then join a vocal channel.", options: [
                { name: "keywords", description: "the keywords to generate the lyrics.", type: ApplicationCommandOptionType.String },
                { name: "creativity", description: "the creativity from the AI (0.1-1).", type: ApplicationCommandOptionType.Number, minValue: 0.1, maxValue: 1 },
                { name: "repetition", description: "true to reduce repetitiveness in the results.", type: ApplicationCommandOptionType.Boolean }
            ]
        },
        {
            name: "random-song-lyrics", description: "randomly get lyrics from a music."
        }
    ];

    commands.forEach(command => {
        if (client.application.commands.cache.some(a => a.name == command.name)) client.application.commands.edit(command);
        else client.application.commands.create(command);
    });
    client.guilds.cache.forEach(guild => {
        guild.commands.set(client.application.commands.cache);
    });

    console.log("Ready !");
});

let voiceConnection;
let audioPlayer = new AudioPlayer();

client.on("interactionCreate", async interaction => {
    if (interaction.type != InteractionType.ApplicationCommand) return;

    if (interaction.commandName == "random-song-lyrics") {
        if (!interaction.member.voice.channel) return interaction.reply("Vous devez être connecté dans un salon vocal !");

        if (!voiceConnection || voiceConnection?.status === VoiceConnectionStatus.Disconnected) {
            voiceConnection = joinVoiceChannel({
                channelId: interaction.member.voice.channelId,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
            voiceConnection = await entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000);
        }

        interaction.reply("Je suis connecté !");

        var slowText;
        var song;
        try {
            song = await new Promise((res, rej) => {
                exec('curl -sS https://www.bestrandoms.com/random-lyrics', (error, body, stderr) => {
                    if (error) return rej(error);
                    if (stderr) return rej(stderr);
                    if (!body) return rej();

                    const $ = cheerio.load(body);

                    const artist = $(
                        '#main > div.container div.content > ul > li > p > span:nth-child(1)',
                    ).text();

                    const title = $(
                        '#main > div.container div.content > ul > li > p > span:nth-child(2)',
                    ).text();

                    const lyrics = $(
                        '#main > div.container div.content > ul > li > pre',
                    ).text();

                    res({ title, artist, lyrics });
                });
            });
        } catch (error) {
            console.error(error);
            slowText = "An error occurred while retrieving the lyrics.";
        }

        if (song) slowText = "Developed by baramex, thanks to www dot bestrandoms dot com. Lyrics from " + song.title + " composed by " + song.artist;

        const stream = new Stream.PassThrough().setMaxListeners(0);
        textToSpeech(stream, slowText || "Unexpected error.", { slow: true });

        if (song) textToSpeech(stream, song.lyrics);

        audioResource = createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        if (voiceConnection.status === VoiceConnectionStatus.Connected) {
            audioPlayer.subscribe(voiceConnection);
            audioPlayer.stop(true);
            audioPlayer.play(audioResource);
        }
    }

    if (interaction.commandName == "random-lyrics-ai") {
        var keywords = interaction.options.getString("keywords", false);
        var creativity = interaction.options.getNumber("creativity", false) || 0.7;
        var repetition = interaction.options.getBoolean("repetition", false) || true;

        if (!interaction.member.voice.channel) return interaction.reply("Vous devez être connecté dans un salon vocal !");

        if (!voiceConnection || voiceConnection?.status === VoiceConnectionStatus.Disconnected) {
            voiceConnection = joinVoiceChannel({
                channelId: interaction.member.voice.channelId,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
            voiceConnection = await entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000);
        }

        interaction.reply("Je suis connecté !");

        const streamWait = new Stream.PassThrough().setMaxListeners(0);
        textToSpeech(streamWait, "Generating lyrics, please wait.\n\n\n.Developed by baramex, thanks to www dot lyrics dot mathigatti dot com.\n\n\n.".repeat(10), { slow: true });

        var audioResource = createAudioResource(streamWait, { inputType: StreamType.Arbitrary, inlineVolume: true });
        if (voiceConnection.status === VoiceConnectionStatus.Connected) {
            voiceConnection.subscribe(audioPlayer);
            audioPlayer.play(audioResource);
        }

        var slowText;
        var song;
        try {
            var res = await axios.post("https://keywords2song-ilfqxfroaq-uc.a.run.app/", { "prefix": keywords, "temperature": creativity, ...(repetition ? { repetition: "1.1" } : {}) }, { timeout: 60000 });
            song = res.data.text.split("\n\n").splice(1).join("\n\n");
        } catch (error) {
            console.error(error);
            slowText = "An error occurred while retrieving the lyrics.";
        }

        console.log(song);

        if (song) slowText = "Lyrics from " + keywords + ":";

        const stream = new Stream.PassThrough().setMaxListeners(0);
        textToSpeech(stream, slowText || "Unexpected error.", { slow: true, lang: "fr" });

        if (song) textToSpeech(stream, song, { slow: true, lang: "fr" });

        audioResource = createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        if (voiceConnection.status === VoiceConnectionStatus.Connected) {
            audioPlayer.stop(true);
            audioPlayer.play(audioResource);
        }
    }
});

async function textToSpeech(stream, text, options = { lang: "en", slow: false, host: 'https://translate.google.com', timeout: 10000, splitPunct: ",.;:?!" }) {
    if (text.length > 200) {
        await getAllAudioBase64(text, options)
            .then(base64Audios => {
                const audioBinaryStream = new Stream.Readable();
                audioBinaryStream.push(Buffer.from(base64Audios.map(a => a.base64).join(""), 'base64'));
                audioBinaryStream.push(null);
                return audioBinaryStream;
            })
            .then(audioStream => audioStream.pipe(stream, { end: false }))
            .catch(console.error);
    }
    else {
        return new Promise((res, rej) => {
            getAudioBase64(text, options)
                .then(base64Audio => {
                    const audioBinaryStream = new Stream.Readable();
                    audioBinaryStream.push(Buffer.from(base64Audio, 'base64'));
                    audioBinaryStream.push(null);
                    return audioBinaryStream;
                })
                .then(audioStream => audioStream.on("close", res).pipe(stream, { end: false }))
                .catch(rej);
        });
    }
}