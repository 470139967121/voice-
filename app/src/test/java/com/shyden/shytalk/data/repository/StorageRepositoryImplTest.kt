package com.shyden.shytalk.data.repository

import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageReference
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class StorageRepositoryImplTest {

    private lateinit var storage: FirebaseStorage
    private lateinit var storageRef: StorageReference
    private lateinit var fileRef: StorageReference
    private lateinit var repo: StorageRepositoryImpl

    @Before
    fun setup() {
        storage = mockk(relaxed = true)
        storageRef = mockk(relaxed = true)
        fileRef = mockk(relaxed = true)
        every { storage.reference } returns storageRef
        every { storageRef.child(any()) } returns fileRef
        repo = StorageRepositoryImpl(storage)
    }

    @Test
    fun `uploadImage returns Error when putBytes throws`() = runTest {
        every { fileRef.putBytes(any()) } throws RuntimeException("Upload failed")

        val result = repo.uploadImage("user-1", "avatars", byteArrayOf(1, 2, 3))

        assertTrue(result is Resource.Error)
        assertTrue((result as Resource.Error).message.contains("Upload failed"))
    }

    @Test
    fun `uploadImage constructs correct storage path`() = runTest {
        every { fileRef.putBytes(any()) } throws RuntimeException("stop here")

        repo.uploadImage("user-1", "avatars", byteArrayOf(1, 2, 3))

        // Verify the child path includes userId and avatars prefix
        io.mockk.verify { storageRef.child(match { it.startsWith("avatars/user-1/") && it.endsWith(".jpg") }) }
    }

    // --- deleteImageByUrl ---

    @Test
    fun `deleteImageByUrl calls delete on reference from url`() = runTest {
        val urlRef = mockk<StorageReference>(relaxed = true)
        every { storage.getReferenceFromUrl("https://firebase.storage/photo.jpg") } returns urlRef
        every { urlRef.delete() } returns com.google.android.gms.tasks.Tasks.forResult(null)

        repo.deleteImageByUrl("https://firebase.storage/photo.jpg")

        io.mockk.verify { urlRef.delete() }
    }

    @Test
    fun `deleteImageByUrl swallows exception silently`() = runTest {
        every { storage.getReferenceFromUrl(any()) } throws IllegalArgumentException("invalid url")

        // Should not throw
        repo.deleteImageByUrl("bad-url")
    }
}
