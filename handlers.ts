import { chromium } from "patchright";
import { saveVideo } from "playwright-video";
import "dotenv/config";

const browser = await chromium.launch({
	// headless: false,
	ignoreDefaultArgs: ["--mute-audio"],
});

let capture : Awaited<ReturnType<typeof saveVideo>>;

export async function startRecording(
	inviteLink: string,
	channelType: "voice" | "stage",
) {
	const context = await browser.newContext({
		viewport: {
			width: 1920,
			height: 1080,
		},
		reducedMotion: "reduce",
	});
	const page = await context.newPage();

	const res = await page.goto(inviteLink);

	if (!res?.ok()) {
		throw new Error("Invalid Link");
	}

	await page.evaluate((token) => {
		setInterval(() => {
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);

			if (!iframe.contentWindow?.localStorage) return null;

			iframe.contentWindow.localStorage.token = `"${token}"`;
		}, 50);

		setTimeout(() => {
			location.reload();
		}, 2500);
	}, process.env.DISCORD_TOKEN);

	await page.getByRole("button").getByText("Accept Invite").click();

	if (channelType === "voice")
		await page.getByRole("button").getByText("Watch Stream").click();
	else {
		await page.getByRole("button").getByText("Got it!").click();
		await page
			.getByRole("button", { name: "Call tile, stream" })
			.locator("..")
			.click();
	}

	await page.getByRole("button", { name: "Show Chat" }).click();

	await page.evaluate(() => {
		const sidebar = document.querySelector('[class^="sidebar"]') as HTMLElement;
		if (!sidebar) return;
		sidebar.style.display = "none";
	});

	// @ts-expect-error
	capture = await saveVideo(page, "videos/quality.mkv", {
		fps: 60,
	});

	return { context, page };
}

export async function endRecording() {
	console.log("stop recording");
	await capture.stop();
	browser.close();
	return;
}