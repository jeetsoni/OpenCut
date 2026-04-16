"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function StudioProjectPage() {
	const router = useRouter();

	useEffect(() => {
		// Redirect to studio page since wizard is removed
		router.push("/studio");
	}, [router]);

	return null;
}
