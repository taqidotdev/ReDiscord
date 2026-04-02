import fs from "node:fs";
import express from "express";
import "dotenv/config";
import {
	displayRecordings,
	endRecording,
	interruptRecording,
	startRecording,
} from "./handlers.ts";

const app = express();

app.use(express.json());

app.get("/", async (_req, res) => {
	try {
		res.status(200).send(displayRecordings());
	} catch (e) {
		if (e instanceof Error) res.status(400).send(`error occured: ${e.message}`);
	}
});

app.post("/", async (req, res) => {
	try {
		const {
			channelInviteLink,
			debug,
			deleteEntireSidebar,
			sendMessages,
			streamer,
			fileName,
		} = req.body;
		if (typeof channelInviteLink !== "string") {
			res
				.status(400)
				.send(
					"Invalid request body, expected { channelInviteLink: string, debug?: boolean, deleteEntireSidebar?: boolean, streamer?: string, sendMessages?: boolean, fileName?: string }",
				);
			return;
		}

		try {
			await startRecording(
				channelInviteLink,
				debug,
				deleteEntireSidebar,
				sendMessages,
				streamer,
				fileName,
			);
		} catch (e) {
			if (e instanceof Error)
				res
					.status(400)
					.send(
						`Recording failed to start, ensure valid data was entered. Error: ${e.message}`,
					);
			return;
		}
		res
			.status(200)
			.send(
				"Recording starting, use DELETE <inviteLink> after the recording to stop recording",
			);
	} catch (e) {
		if (e instanceof Error) res.status(400).send(`error occured: ${e.message}`);
	}
});

app.delete("/", async (req, res) => {
	try {
		const { channelInviteLink } = req.body;

		if (!channelInviteLink) {
			res
				.status(400)
				.send(
					"Valid invite link not provided, use GET to display ongoing recordings",
				);
			return;
		}

		try {
			endRecording(channelInviteLink).catch((e) => {
				res.status(400).send(`Error occured while stopping recording: ${e}`);
			});
		} catch (e) {
			res.status(400).send(`Error occured while stopping recording: ${e}`);
			return;
		}
		res.status(200).send("Recording being stopped");
	} catch (e) {
		if (e instanceof Error) res.status(400).send(`error occured: ${e.message}`);
	}
});

app.delete("/interrupt", async (req, res) => {
	try {
		const { channelInviteLink } = req.body;

		if (!channelInviteLink) {
			res.status(400).send("Valid invite link not provided");
		}

		try {
			interruptRecording(channelInviteLink);
		} catch (e) {
			res.status(400).send(`Error occured while interrupting recording: ${e}`);
			return;
		}
		res.status(200).send("Recording interrupted");
	} catch (e) {
		if (e instanceof Error) res.status(400).send(`error occured: ${e.message}`);
	}
});

fs.writeFileSync(".pid", process.pid.toString());

app.listen(process.env.PORT, () => {
	console.log(
		`server started at port ${process.env.PORT} (PID: ${process.pid})`,
	);
});