package com.iml1s.xmrigminer.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File

class XmrigBinaryResolverTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun `prefers packaged native library`() {
        val nativeDir = tmp.newFolder("lib")
        val packaged = File(nativeDir, XmrigBinaryResolver.PACKAGED_NAME)
        packaged.writeText("elf")

        val resolver = XmrigBinaryResolver(
            nativeLibraryDir = nativeDir,
            filesDir = tmp.newFolder("files"),
            openAsset = { null }
        )

        assertEquals(packaged.absolutePath, resolver.resolve().absolutePath)
    }

    @Test
    fun `falls back to assets when jniLibs missing`() {
        val filesDir = tmp.newFolder("files")
        val resolver = XmrigBinaryResolver(
            nativeLibraryDir = tmp.newFolder("empty-lib"),
            filesDir = filesDir,
            openAsset = { name ->
                if (name == "xmrig_arm64") ByteArrayInputStream("asset-binary".toByteArray()) else null
            }
        )

        val resolved = resolver.resolve()
        assertEquals(File(filesDir, XmrigBinaryResolver.EXTRACTED_NAME).absolutePath, resolved.absolutePath)
        assertEquals("asset-binary", resolved.readText())
        assertTrue(resolved.canExecute() || resolved.isFile)
    }

    @Test(expected = IllegalStateException::class)
    fun `throws when binary is missing`() {
        XmrigBinaryResolver(
            nativeLibraryDir = tmp.newFolder("empty-lib"),
            filesDir = tmp.newFolder("files"),
            openAsset = { null }
        ).resolve()
    }
}
