package expo.modules.tempoloopmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GalleryPickerStrategyResolverTest {
  @Test
  fun `prefers Android photo picker when available`() {
    assertEquals(
      GalleryPickerStrategy.PHOTO_PICKER,
      GalleryPickerStrategyResolver.resolve(true, true, true)
    )
  }

  @Test
  fun `uses MediaStore gallery on older Honor-style devices`() {
    assertEquals(
      GalleryPickerStrategy.MEDIA_STORE_GALLERY,
      GalleryPickerStrategyResolver.resolve(false, true, true)
    )
  }

  @Test
  fun `falls back to the screenshots-initialized document picker`() {
    assertEquals(
      GalleryPickerStrategy.DOCUMENTS_SCREENSHOTS,
      GalleryPickerStrategyResolver.resolve(false, false, true)
    )
  }

  @Test
  fun `reports no strategy when the device has no picker`() {
    assertNull(GalleryPickerStrategyResolver.resolve(false, false, false))
  }
}
