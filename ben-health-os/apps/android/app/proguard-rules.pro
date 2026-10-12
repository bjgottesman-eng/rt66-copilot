# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.benhealthos.app.**$$serializer { *; }
-keepclassmembers class com.benhealthos.app.** { *** Companion; }
-keepclasseswithmembers class com.benhealthos.app.** { kotlinx.serialization.KSerializer serializer(...); }
